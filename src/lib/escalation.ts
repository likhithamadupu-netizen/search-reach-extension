import { useMemo } from "react";
import { matchDonors } from "@/lib/matching";
import type { BloodRequest } from "@/lib/demo-data";
import {
  canEscalate,
  currentSearchRadius,
  escalateSearch,
  escalationsFor,
  nextEscalationRadius,
  useAlerts,
  useDonors,
  useEscalations,
  type EscalationRecord,
} from "@/lib/store";

/**
 * Day 5 — shared escalation logic. Every escalation entry point (request page,
 * dashboard) uses this hook so the business rules live in exactly one place.
 * The actual mutation always goes through `escalateSearch` in the store.
 */
export function useEscalation(request: BloodRequest) {
  const donors = useDonors();
  const alerts = useAlerts();
  const escalations = useEscalations();

  const history = useMemo(() => escalationsFor(escalations, request.id), [escalations, request.id]);
  const radiusKm = currentSearchRadius(escalations, request.id);
  const nextRadiusKm = nextEscalationRadius(escalations, request.id);
  const gate = canEscalate(request, alerts, escalations);

  /** Compatible, eligible, available donors inside the NEW radius, not yet alerted. */
  const newCandidates = useMemo(() => {
    if (nextRadiusKm === null) return [];
    const alerted = new Set(alerts.filter((a) => a.requestId === request.id).map((a) => a.donorId));
    return matchDonors(donors, {
      recipientGroup: request.bloodGroup,
      origin: { lat: request.lat, lng: request.lng },
      radiusKm: nextRadiusKm,
      urgency: request.urgency,
      sort: "best",
    })
      .filter((m) => m.donor.available && m.eligibility.status === "eligible")
      .filter((m) => !alerted.has(m.donor.id));
  }, [donors, alerts, request, nextRadiusKm]);

  const escalationNumber = history.length + 1;

  function run(): EscalationRecord | null {
    if (nextRadiusKm === null) return null;
    return escalateSearch(request.id, {
      previousRadius: radiusKm,
      newRadius: nextRadiusKm,
      newlyFoundCount: newCandidates.length,
      candidates: newCandidates.map((m) => ({
        donorId: m.donor.id,
        score: Math.round(m.score),
        distanceKm: m.distanceKm,
        distanceLabel: m.distanceLabel,
        why: m.why,
        primaryReason: m.primaryReason,
      })),
    });
  }

  return {
    history,
    radiusKm,
    nextRadiusKm,
    gate,
    canEscalate: gate.ok && nextRadiusKm !== null,
    newCandidates,
    escalationNumber,
    escalationCount: history.length,
    run,
  };
}
