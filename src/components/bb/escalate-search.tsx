import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Radar, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/bb/badges";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { matchDonors } from "@/lib/matching";
import type { BloodRequest } from "@/lib/demo-data";
import {
  MAX_ESCALATIONS,
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

  const history = useMemo(
    () => escalationsFor(escalations, request.id),
    [escalations, request.id],
  );
  const radiusKm = currentSearchRadius(escalations, request.id);
  const nextRadiusKm = nextEscalationRadius(escalations, request.id);
  const gate = canEscalate(request, alerts, escalations);

  /** Compatible, eligible, available donors inside the NEW radius, not yet alerted. */
  const newCandidates = useMemo(() => {
    if (nextRadiusKm === null) return [];
    const alerted = new Set(
      alerts.filter((a) => a.requestId === request.id).map((a) => a.donorId),
    );
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

/** Compact "Search radius: 20 km" indicator. */
export function SearchRadiusChip({ request }: { request: BloodRequest }) {
  const { radiusKm, escalationCount } = useEscalation(request);
  return (
    <Chip tone={escalationCount > 0 ? "warning" : "neutral"}>
      <Radar className="h-3 w-3" aria-hidden />
      Search radius: {radiusKm} km
      {escalationCount > 0 ? ` · expanded ${escalationCount}/${MAX_ESCALATIONS}` : ""}
    </Chip>
  );
}

/**
 * "Escalate Search" action + confirmation dialog. Renders nothing when the
 * request is not eligible for escalation (closed, unalerted, accepted, capped).
 */
export function EscalateSearchButton({
  request,
  size = "default",
  variant = "outline",
  className,
}: {
  request: BloodRequest;
  size?: "default" | "sm";
  variant?: "default" | "outline";
  className?: string;
}) {
  const esc = useEscalation(request);
  const [open, setOpen] = useState(false);

  if (!esc.canEscalate) return null;

  function confirm() {
    try {
      const record = esc.run();
      if (!record) {
        toast.error("Search could not be expanded right now.");
        setOpen(false);
        return;
      }
      setOpen(false);
      if (record.newlyAlertedCount === 0) {
        toast.info(`Search expanded to ${record.newRadius} km`, {
          description: "No additional compatible donors were found in the wider radius.",
        });
        return;
      }
      toast.success(`Search expanded to ${record.newRadius} km`, {
        description: `${record.newlyAlertedCount} additional compatible donor${
          record.newlyAlertedCount === 1 ? "" : "s"
        } alerted. Demo alerts only — no SMS or push is sent.`,
      });
    } catch {
      toast.error("Could not expand the search. Please try again.");
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        <TrendingUp className="h-4 w-4" aria-hidden /> Escalate Search
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Expand the emergency search?</DialogTitle>
            <DialogDescription>
              No donor has accepted yet. BloodBridge will widen the search radius and alert
              additional compatible donors who have not been alerted before.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Current radius" value={`${esc.radiusKm} km`} />
            <Stat label="New radius" value={`${esc.nextRadiusKm} km`} />
            <Stat
              label="Escalation"
              value={`${esc.escalationNumber}/${MAX_ESCALATIONS}`}
            />
            <Stat label="New donors found" value={String(esc.newCandidates.length)} />
          </div>

          <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            {esc.newCandidates.length > 0
              ? `${esc.newCandidates.length} additional compatible donor${
                  esc.newCandidates.length === 1 ? "" : "s"
                } will be alerted. Donors already alerted are never alerted twice.`
              : `No additional eligible, available compatible donors sit between ${esc.radiusKm} km and ${esc.nextRadiusKm} km. The wider radius will still be recorded.`}
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirm}>
              <TrendingUp className="h-4 w-4" aria-hidden /> Confirm &amp; expand search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Escalation history — hidden entirely when nothing has been escalated. */
export function EscalationHistory({ request }: { request: BloodRequest }) {
  const { history, radiusKm } = useEscalation(request);
  if (history.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Radar className="h-4 w-4 text-primary" aria-hidden />
          Escalation history
        </p>
        <Chip tone="neutral">Current radius {radiusKm} km</Chip>
      </div>

      <ol className="mt-3 space-y-2">
        {history.map((e) => (
          <li key={e.id} className="rounded-lg border border-border bg-background/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold">
                Escalation #{e.escalationNumber}
                <span className="ml-2 font-semibold text-muted-foreground">
                  {e.previousRadius} km → {e.newRadius} km
                </span>
              </p>
              <Chip tone="success">{e.status}</Chip>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {e.newlyFoundCount} additional donor{e.newlyFoundCount === 1 ? "" : "s"} found ·{" "}
              {e.newlyAlertedCount} alerted · {new Date(e.timestamp).toLocaleString()}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3 text-center">
      <p className="font-display text-2xl">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
