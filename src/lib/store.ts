import { useSyncExternalStore } from "react";
import type { BloodGroup } from "./blood";
import {
  CITY_CENTER,
  DEMO_DONORS,
  DEMO_REQUESTS,
  type BloodRequest,
  type Donor,
  type RequestStatus,
} from "./demo-data";

export type Role = "donor" | "seeker";

export interface AppUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string;
  /** donor-only */
  donorId?: string | undefined;
}
/**
 * Stored authentication account.
 *
 * Passwords are stored as SHA-256 hashes, not plain text.
 * This is still a frontend/demo authentication system.
 * Production authentication should be handled by the backend.
 */
interface AuthAccount {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  donorId?: string;
}

export type AlertResponse = "pending" | "accepted" | "declined";

export interface EmergencyAlert {
  id: string;
  requestId: string;
  donorId: string;
  createdAt: string;
  response: AlertResponse;
  respondedAt: string | null;

  score: number;
  distanceKm: number;
  distanceLabel: string;
  why: string[];
  primaryReason: string;

  viaEscalation?: number;
}

export interface EscalationRecord {
  id: string;
  requestId: string;
  previousRadius: number;
  newRadius: number;
  newlyFoundCount: number;
  newlyAlertedCount: number;
  timestamp: string;
  escalationNumber: number;
  status: "completed";
}

export const BASE_SEARCH_RADIUS_KM = 10;
export const ESCALATION_STEP_KM = 10;
export const MAX_ESCALATIONS = 2;

export interface TrackingEvent {
  at: string;
  label: string;
}

export interface TrackingRecord {
  override: "en_route" | "donation_completed" | null;
  timestamps: Partial<Record<string, string>>;
  events: TrackingEvent[];
}

interface AppState {
  user: AppUser | null;

  /**
   * Authentication accounts created by users.
   */
  accounts: AuthAccount[];

  donors: Donor[];
  requests: BloodRequest[];

  invites: Record<string, string[]>;

  alerts: EmergencyAlert[];

  tracking: Record<string, TrackingRecord>;

  escalations: EscalationRecord[];

  nextRequestNumber: number;
}

const STORAGE_KEY = "bloodbridge.state.v4";

/* -------------------------------------------------------------------------- */
/*                              INITIAL STATE                                 */
/* -------------------------------------------------------------------------- */

function initialState(): AppState {
  return {
    user: null,

    accounts: [],

    donors: DEMO_DONORS,

    requests: DEMO_REQUESTS,

    invites: {},

    alerts: [],

    tracking: {},

    escalations: [],

    nextRequestNumber: 1043,
  };
}

export const EMPTY_TRACKING: TrackingRecord = {
  override: null,
  timestamps: {},
  events: [],
};

/* -------------------------------------------------------------------------- */
/*                         PASSWORD HASHING                                   */
/* -------------------------------------------------------------------------- */

/**
 * Creates a SHA-256 password hash using the browser Web Crypto API.
 *
 * The raw password is never saved.
 */
async function hashPassword(password: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Secure authentication is not available in this browser.");
  }

  const data = new TextEncoder().encode(password);

  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* -------------------------------------------------------------------------- */
/*                              TRACKING                                    */
/* -------------------------------------------------------------------------- */

function withTracking(
  s: AppState,
  requestId: string,
  patch: (rec: TrackingRecord) => TrackingRecord,
): Record<string, TrackingRecord> {
  const rec = s.tracking[requestId] ?? {
    override: null,
    timestamps: {},
    events: [],
  };

  return {
    ...s.tracking,
    [requestId]: patch(rec),
  };
}

function stamp(
  rec: TrackingRecord,
  stage: string,
  label: string,
  at = new Date().toISOString(),
): TrackingRecord {
  return {
    ...rec,

    timestamps: {
      ...rec.timestamps,
      [stage]: rec.timestamps[stage] ?? at,
    },

    events: [
      ...rec.events,
      {
        at,
        label,
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/*                              STORE SETUP                                   */
/* -------------------------------------------------------------------------- */

let state: AppState = initialState();

let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function persist() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage unavailable — prototype continues working in memory */
  }
}

export function hydrateStore() {
  if (hydrated || typeof window === "undefined") return;

  hydrated = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;

      state = {
        ...initialState(),
        ...parsed,

        /**
         * Older v3 data did not contain accounts.
         */
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      };

      emit();
    }
  } catch {
    /* Ignore corrupt state */
  }
}

function setState(update: (prev: AppState) => AppState) {
  state = update(state);

  persist();

  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);

  return () => listeners.delete(cb);
}

const getSnapshot = () => state;

const serverSnapshot = initialState();

const getServerSnapshot = () => serverSnapshot;

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getSnapshot()),
    () => selector(getServerSnapshot()),
  );
}

/* -------------------------------------------------------------------------- */
/*                                  HOOKS                                     */
/* -------------------------------------------------------------------------- */

export const useUser = () => useAppState((s) => s.user);

export const useDonors = () => useAppState((s) => s.donors);

export const useRequests = () => useAppState((s) => s.requests);

export const useInvites = () => useAppState((s) => s.invites);

export const useAlerts = () => useAppState((s) => s.alerts);

export const useTracking = () => useAppState((s) => s.tracking);

export const useEscalations = () => useAppState((s) => s.escalations);

export function currentUser() {
  return state.user;
}

/* -------------------------------------------------------------------------- */
/*                                   AUTH                                     */
/* -------------------------------------------------------------------------- */

export interface DonorSignup {
  bloodGroup: BloodGroup;
  area: string;
  lastDonationDate: string | null;
  available: boolean;
}

export interface RegisterData {
  role: Role;
  name: string;
  email: string;
  phone: string;
  password: string;
}

/**
 * Register a new donor or seeker.
 *
 * Password is hashed before being stored.
 */
export async function register(data: RegisterData, donorData?: DonorSignup): Promise<AppUser> {
  const name = data.name.trim();
  const email = data.email.trim().toLowerCase();
  const phone = data.phone.trim();

  if (!name || !email || !phone || !data.password) {
    throw new Error("All required fields must be filled.");
  }

  if (data.password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const existingAccount = state.accounts.find((account) => account.email.toLowerCase() === email);

  if (existingAccount) {
    throw new Error("An account with this email already exists.");
  }

  if (data.role === "donor" && !donorData) {
    throw new Error("Donor details are required.");
  }

  const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const passwordHash = await hashPassword(data.password);

  let donorId: string | undefined;

  if (data.role === "donor" && donorData) {
    donorId = `me-${id}`;

    const donor: Donor = {
      id: donorId,

      name,

      bloodGroup: donorData.bloodGroup,

      area: donorData.area || "Banjara Hills",

      city: "Hyderabad",

      lat: CITY_CENTER.lat + 0.004,

      lng: CITY_CENTER.lng + 0.004,

      available: donorData.available,

      verified: false,

      lastDonationDate: donorData.lastDonationDate,

      donations: 0,

      avgResponseMinutes: 15,

      phone,
    };

    const account: AuthAccount = {
      id,

      role: "donor",

      name,

      email,

      phone,

      passwordHash,

      donorId,
    };

    const user: AppUser = {
      id,

      role: "donor",

      name,

      email,

      phone,

      donorId,
    };

    setState((s) => ({
      ...s,

      accounts: [account, ...s.accounts],

      donors: [donor, ...s.donors],

      user,
    }));

    return user;
  }

  const account: AuthAccount = {
    id,

    role: "seeker",

    name,

    email,

    phone,

    passwordHash,
  };

  const user: AppUser = {
    id,

    role: "seeker",

    name,

    email,

    phone,
  };

  setState((s) => ({
    ...s,

    accounts: [account, ...s.accounts],

    user,
  }));

  return user;
}

/**
 * Login using email, password and selected role.
 */
export async function login(email: string, password: string, role: Role): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !password.trim()) {
    throw new Error("Enter your email and password.");
  }

  const account = state.accounts.find((a) => a.email.toLowerCase() === normalizedEmail);

  if (!account) {
    throw new Error("No account found with this email.");
  }

  if (account.role !== role) {
    throw new Error(`This account is registered as a ${account.role}, not a ${role}.`);
  }

  const passwordHash = await hashPassword(password);

  if (passwordHash !== account.passwordHash) {
    throw new Error("Incorrect password.");
  }

  const user: AppUser = {
    id: account.id,

    role: account.role,

    name: account.name,

    email: account.email,

    phone: account.phone,

    donorId: account.donorId,
  };

  setState((s) => ({
    ...s,

    user,
  }));

  return user;
}

export function logout() {
  setState((s) => ({
    ...s,

    user: null,
  }));
}

export function updateProfile(patch: Partial<AppUser>) {
  setState((s) =>
    s.user
      ? {
          ...s,

          user: {
            ...s.user,

            ...patch,
          },
        }
      : s,
  );
}

/* -------------------------------------------------------------------------- */
/*                                  DONORS                                    */
/* -------------------------------------------------------------------------- */

export function setDonorAvailability(donorId: string, available: boolean) {
  setState((s) => ({
    ...s,

    donors: s.donors.map((d) =>
      d.id === donorId
        ? {
            ...d,

            available,
          }
        : d,
    ),
  }));
}

export function updateDonor(donorId: string, patch: Partial<Donor>) {
  setState((s) => ({
    ...s,

    donors: s.donors.map((d) =>
      d.id === donorId
        ? {
            ...d,

            ...patch,
          }
        : d,
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/*                     DONOR ACTIVE REQUEST PROTECTION                        */
/* -------------------------------------------------------------------------- */

export function donorHasActiveRequest(donorId: string, requests: BloodRequest[]): boolean {
  return requests.some(
    (request) =>
      request.acceptedDonorIds.includes(donorId) &&
      request.status !== "fulfilled" &&
      request.status !== "cancelled",
  );
}

export function getDonorActiveRequest(
  donorId: string,
  requests: BloodRequest[],
): BloodRequest | null {
  return (
    requests.find(
      (request) =>
        request.acceptedDonorIds.includes(donorId) &&
        request.status !== "fulfilled" &&
        request.status !== "cancelled",
    ) ?? null
  );
}

export function canDonorAcceptRequest(
  donorId: string,
  requestId: string,
): {
  ok: boolean;
  reason: string | null;
} {
  const request = state.requests.find((r) => r.id === requestId);

  if (!request) {
    return {
      ok: false,
      reason: "Request not found.",
    };
  }

  if (request.status === "fulfilled" || request.status === "cancelled") {
    return {
      ok: false,
      reason: "This request is already closed.",
    };
  }

  const activeRequest = getDonorActiveRequest(donorId, state.requests);

  if (activeRequest && activeRequest.id !== requestId) {
    return {
      ok: false,
      reason:
        "You already accepted another emergency request. Complete or cancel that request before accepting a new one.",
    };
  }

  return {
    ok: true,
    reason: null,
  };
}

/* -------------------------------------------------------------------------- */
/*                                REQUESTS                                    */
/* -------------------------------------------------------------------------- */

export interface NewRequestInput {
  bloodGroup: BloodGroup;
  units: number;
  hospital: string;
  area: string;
  lat: number;
  lng: number;
  requiredBy: string;
  urgency: BloodRequest["urgency"];
  notes?: string;
}

export function createRequest(input: NewRequestInput): BloodRequest {
  const user = state.user;

  const id = `BB-${state.nextRequestNumber}`;

  const request: BloodRequest = {
    ...input,

    id,

    seekerId: user?.id ?? "guest",

    seekerName: user?.name ?? "Guest seeker",

    status: "searching",

    createdAt: new Date().toISOString(),

    notifiedDonorIds: [],

    acceptedDonorIds: [],
  };

  setState((s) => ({
    ...s,

    requests: [request, ...s.requests],

    tracking: withTracking(s, id, (rec) => {
      const withCreated = stamp(rec, "created", "Emergency request created", request.createdAt);

      return stamp(
        withCreated,
        "matching",
        "Smart Match Engine ranked compatible donors",
        request.createdAt,
      );
    }),

    nextRequestNumber: s.nextRequestNumber + 1,
  }));

  return request;
}

export function notifyDonors(requestId: string, donorIds: string[]) {
  setState((s) => ({
    ...s,

    requests: s.requests.map((r) =>
      r.id === requestId
        ? {
            ...r,

            status: r.status === "searching" ? "notified" : r.status,

            notifiedDonorIds: Array.from(new Set([...r.notifiedDonorIds, ...donorIds])),
          }
        : r,
    ),
  }));
}

export function inviteDonor(requestId: string, donorId: string) {
  setState((s) => ({
    ...s,

    invites: {
      ...s.invites,

      [requestId]: Array.from(new Set([...(s.invites[requestId] ?? []), donorId])),
    },

    requests: s.requests.map((r) =>
      r.id === requestId
        ? {
            ...r,

            status: r.status === "searching" ? "notified" : r.status,

            notifiedDonorIds: Array.from(new Set([...r.notifiedDonorIds, donorId])),
          }
        : r,
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/*                         ACCEPT REQUEST DIRECTLY                            */
/* -------------------------------------------------------------------------- */

export function acceptRequest(requestId: string, donorId: string): boolean {
  const request = state.requests.find((r) => r.id === requestId);

  if (!request) {
    return false;
  }

  if (request.status === "fulfilled" || request.status === "cancelled") {
    return false;
  }

  const activeRequest = getDonorActiveRequest(donorId, state.requests);

  if (activeRequest && activeRequest.id !== requestId) {
    return false;
  }

  const now = new Date().toISOString();

  const donorName = state.donors.find((d) => d.id === donorId)?.name ?? "A donor";

  setState((s) => ({
    ...s,

    alerts: s.alerts.map((a) =>
      a.requestId === requestId && a.donorId === donorId && a.response === "pending"
        ? {
            ...a,

            response: "accepted",

            respondedAt: now,
          }
        : a,
    ),

    tracking: withTracking(s, requestId, (rec) =>
      stamp(rec, "confirmed", `${donorName} accepted the emergency`, now),
    ),

    requests: s.requests.map((r) =>
      r.id === requestId
        ? {
            ...r,

            status: r.status === "fulfilled" ? r.status : "accepted",

            acceptedDonorIds: Array.from(new Set([...r.acceptedDonorIds, donorId])),
          }
        : r,
    ),

    donors: s.donors.map((d) =>
      d.id === donorId
        ? {
            ...d,

            available: false,
          }
        : d,
    ),
  }));

  return true;
}

/* -------------------------------------------------------------------------- */
/*                           EMERGENCY ALERTS                                 */
/* -------------------------------------------------------------------------- */

export interface EmergencyAlertInput {
  donorId: string;
  score: number;
  distanceKm: number;
  distanceLabel: string;
  why: string[];
  primaryReason: string;
}

export function createEmergencyAlerts(requestId: string, inputs: EmergencyAlertInput[]): number {
  const existing = new Set(
    state.alerts.filter((a) => a.requestId === requestId).map((a) => a.donorId),
  );

  const fresh = inputs.filter((i) => !existing.has(i.donorId));

  if (fresh.length === 0) return 0;

  const now = new Date().toISOString();

  const created: EmergencyAlert[] = fresh.map((i) => ({
    id: `al-${requestId}-${i.donorId}`,

    requestId,

    donorId: i.donorId,

    createdAt: now,

    response: "pending",

    respondedAt: null,

    score: i.score,

    distanceKm: i.distanceKm,

    distanceLabel: i.distanceLabel,

    why: i.why,

    primaryReason: i.primaryReason,
  }));

  setState((s) => ({
    ...s,

    alerts: [...created, ...s.alerts],

    tracking: withTracking(s, requestId, (rec) =>
      stamp(rec, "alerted", `${created.length} compatible donor(s) alerted`, now),
    ),

    requests: s.requests.map((r) =>
      r.id === requestId
        ? {
            ...r,

            status: r.status === "searching" ? "notified" : r.status,

            notifiedDonorIds: Array.from(
              new Set([...r.notifiedDonorIds, ...created.map((c) => c.donorId)]),
            ),
          }
        : r,
    ),
  }));

  return created.length;
}

/* -------------------------------------------------------------------------- */
/*                         DONOR ALERT RESPONSE                               */
/* -------------------------------------------------------------------------- */

export function respondToAlert(alertId: string, response: "accepted" | "declined"): boolean {
  const alert = state.alerts.find((a) => a.id === alertId);

  if (!alert || alert.response !== "pending") {
    return false;
  }

  const request = state.requests.find((r) => r.id === alert.requestId);

  if (!request || request.status === "cancelled") {
    return false;
  }

  if (response === "accepted") {
    const activeRequest = getDonorActiveRequest(alert.donorId, state.requests);

    if (activeRequest && activeRequest.id !== alert.requestId) {
      return false;
    }
  }

  const now = new Date().toISOString();

  const donorName = state.donors.find((d) => d.id === alert.donorId)?.name ?? "A donor";

  setState((s) => ({
    ...s,

    alerts: s.alerts.map((a) =>
      a.id === alertId
        ? {
            ...a,

            response,

            respondedAt: now,
          }
        : a,
    ),

    tracking: withTracking(s, alert.requestId, (rec) =>
      response === "accepted"
        ? stamp(rec, "confirmed", `${donorName} accepted the emergency`, now)
        : {
            ...rec,

            events: [
              ...rec.events,
              {
                at: now,

                label: `${donorName} declined`,
              },
            ],
          },
    ),

    requests:
      response === "accepted"
        ? s.requests.map((r) =>
            r.id === alert.requestId
              ? {
                  ...r,

                  status: r.status === "fulfilled" ? r.status : "accepted",

                  acceptedDonorIds: Array.from(new Set([...r.acceptedDonorIds, alert.donorId])),
                }
              : r,
          )
        : s.requests,

    donors:
      response === "accepted"
        ? s.donors.map((d) =>
            d.id === alert.donorId
              ? {
                  ...d,

                  available: false,
                }
              : d,
          )
        : s.donors,
  }));

  return true;
}

/* -------------------------------------------------------------------------- */
/*                             ALERT SUMMARY                                  */
/* -------------------------------------------------------------------------- */

export interface AlertSummary {
  alerted: number;
  accepted: number;
  pending: number;
  declined: number;
}

export function summarizeAlerts(alerts: EmergencyAlert[], requestId: string): AlertSummary {
  const scoped = alerts.filter((a) => a.requestId === requestId);

  return {
    alerted: scoped.length,

    accepted: scoped.filter((a) => a.response === "accepted").length,

    pending: scoped.filter((a) => a.response === "pending").length,

    declined: scoped.filter((a) => a.response === "declined").length,
  };
}

/* -------------------------------------------------------------------------- */
/*                         EMERGENCY ESCALATION                              */
/* -------------------------------------------------------------------------- */

export function escalationsFor(escalations: EscalationRecord[], requestId: string) {
  return escalations
    .filter((e) => e.requestId === requestId)
    .sort((a, b) => a.escalationNumber - b.escalationNumber);
}

export function currentSearchRadius(escalations: EscalationRecord[], requestId: string): number {
  const scoped = escalationsFor(escalations, requestId);

  const last = scoped[scoped.length - 1];

  return last ? last.newRadius : BASE_SEARCH_RADIUS_KM;
}

export function nextEscalationRadius(
  escalations: EscalationRecord[],
  requestId: string,
): number | null {
  if (escalationsFor(escalations, requestId).length >= MAX_ESCALATIONS) {
    return null;
  }

  return currentSearchRadius(escalations, requestId) + ESCALATION_STEP_KM;
}

export interface EscalationGate {
  ok: boolean;
  reason: string | null;
}

export function canEscalate(
  request: BloodRequest,
  alerts: EmergencyAlert[],
  escalations: EscalationRecord[],
): EscalationGate {
  if (request.status === "fulfilled" || request.status === "cancelled") {
    return {
      ok: false,
      reason: "This request is closed.",
    };
  }

  const scoped = alerts.filter((a) => a.requestId === request.id);

  if (request.acceptedDonorIds.length > 0 || scoped.some((a) => a.response === "accepted")) {
    return {
      ok: false,
      reason: "A donor has already accepted this request.",
    };
  }

  if (scoped.length === 0) {
    return {
      ok: false,
      reason: "Alert compatible donors before expanding the search.",
    };
  }

  if (escalationsFor(escalations, request.id).length >= MAX_ESCALATIONS) {
    return {
      ok: false,
      reason: "Maximum search expansion reached.",
    };
  }

  return {
    ok: true,
    reason: null,
  };
}

export interface EscalateSearchInput {
  previousRadius: number;
  newRadius: number;
  newlyFoundCount: number;
  candidates: EmergencyAlertInput[];
}

export function escalateSearch(
  requestId: string,
  input: EscalateSearchInput,
): EscalationRecord | null {
  const request = state.requests.find((r) => r.id === requestId);

  if (!request) return null;

  if (!canEscalate(request, state.alerts, state.escalations).ok) {
    return null;
  }

  const now = new Date().toISOString();

  const escalationNumber = escalationsFor(state.escalations, requestId).length + 1;

  const existing = new Set(
    state.alerts.filter((a) => a.requestId === requestId).map((a) => a.donorId),
  );

  const created: EmergencyAlert[] = input.candidates
    .filter((i) => !existing.has(i.donorId))
    .map((i) => ({
      id: `al-${requestId}-${i.donorId}`,

      requestId,

      donorId: i.donorId,

      createdAt: now,

      response: "pending",

      respondedAt: null,

      score: i.score,

      distanceKm: i.distanceKm,

      distanceLabel: i.distanceLabel,

      why: i.why,

      primaryReason: i.primaryReason,

      viaEscalation: escalationNumber,
    }));

  const record: EscalationRecord = {
    id: `esc-${requestId}-${escalationNumber}`,

    requestId,

    previousRadius: input.previousRadius,

    newRadius: input.newRadius,

    newlyFoundCount: input.newlyFoundCount,

    newlyAlertedCount: created.length,

    timestamp: now,

    escalationNumber,

    status: "completed",
  };

  setState((s) => ({
    ...s,

    alerts: [...created, ...s.alerts],

    escalations: [...s.escalations, record],

    tracking: withTracking(s, requestId, (rec) => {
      const expanded = stamp(
        rec,

        `escalated_${escalationNumber}`,

        `No response — search expanded ${input.previousRadius} km → ${input.newRadius} km`,

        now,
      );

      return {
        ...expanded,

        events: [
          ...expanded.events,

          {
            at: now,

            label:
              created.length > 0
                ? `${created.length} additional compatible donor(s) alerted`
                : `No additional compatible donors found within ${input.newRadius} km`,
          },
        ],
      };
    }),

    requests: s.requests.map((r) =>
      r.id === requestId
        ? {
            ...r,

            status: r.status === "searching" ? "notified" : r.status,

            notifiedDonorIds: Array.from(
              new Set([...r.notifiedDonorIds, ...created.map((c) => c.donorId)]),
            ),
          }
        : r,
    ),
  }));

  return record;
}

/* -------------------------------------------------------------------------- */
/*                            REQUEST STATUS                                  */
/* -------------------------------------------------------------------------- */

export function setRequestStatus(requestId: string, status: RequestStatus) {
  setState((s) => {
    const request = s.requests.find((r) => r.id === requestId);

    const donorsToRelease =
      status === "fulfilled" || status === "cancelled" ? (request?.acceptedDonorIds ?? []) : [];

    return {
      ...s,

      requests: s.requests.map((r) =>
        r.id === requestId
          ? {
              ...r,

              status,
            }
          : r,
      ),

      donors: s.donors.map((d) =>
        donorsToRelease.includes(d.id)
          ? {
              ...d,

              available: true,
            }
          : d,
      ),

      tracking:
        status === "fulfilled"
          ? withTracking(s, requestId, (rec) => stamp(rec, "fulfilled", "Request fulfilled"))
          : status === "cancelled"
            ? withTracking(s, requestId, (rec) => stamp(rec, "cancelled", "Request cancelled"))
            : s.tracking,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                            LIVE TRACKING                                   */
/* -------------------------------------------------------------------------- */

export function markTracking(requestId: string, stage: "en_route" | "donation_completed"): boolean {
  const request = state.requests.find((r) => r.id === requestId);

  if (!request || request.status === "fulfilled" || request.status === "cancelled") {
    return false;
  }

  const rec = state.tracking[requestId];

  const current = rec?.override ?? null;

  if (stage === "en_route") {
    if (current !== null) {
      return false;
    }

    if (request.acceptedDonorIds.length === 0) {
      return false;
    }
  } else if (current !== "en_route") {
    return false;
  }

  setState((s) => ({
    ...s,

    tracking: withTracking(s, requestId, (r) => ({
      ...stamp(
        r,

        stage,

        stage === "en_route" ? "Donor marked En Route" : "Donation marked completed",
      ),

      override: stage,
    })),
  }));

  return true;
}

/* -------------------------------------------------------------------------- */
/*                              RESET DEMO                                    */
/* -------------------------------------------------------------------------- */

export function resetDemoData() {
  const user = state.user;

  state = {
    ...initialState(),

    user,
  };

  persist();

  emit();
}
