import { useEffect, useMemo, useState } from "react";
import { AccuracyChart } from "../components/AccuracyChart";
import { NotifySettings } from "../components/NotifySettings";
import { PlanCard } from "../components/PlanCard";
import { getFeatures, getStats, planToday, type Features, type Plan, type Stats } from "../lib/api";
import { buildCurriculum } from "../lib/curriculum";
import { learnerId } from "../lib/learner";
import { buildPlanRequest } from "../lib/planInput";
import { requireProfile } from "../lib/requireProfile";
import { loadProgress, weakItems } from "../lib/progress";

const NO_FEATURES: Features = { stats: false, notify: false, agent: false };

export function StatsPage() {
  const [profile] = useState(() => requireProfile());
  const units = useMemo(() => buildCurriculum(profile), [profile]);
  const progress = useMemo(() => loadProgress(), []);
  const planReq = useMemo(() => buildPlanRequest(units, progress, weakItems(progress, 5), learnerId()), [units, progress]);

  const [features, setFeatures] = useState<Features | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  const [statsFailed, setStatsFailed] = useState(false);

  useEffect(() => {
    getFeatures().then(setFeatures).catch(() => setFeatures(NO_FEATURES));
    getStats(learnerId()).then(setStats).catch((e) => {
      console.error(e);
      setStatsFailed(true);
      setStats({ daily: [], items: [] });
    });
    if (planReq)
      planToday(planReq).then(setPlan).catch((e) => {
        console.error(e);
        setPlanFailed(true);
      });
  }, [planReq]);

  return (
    <div className="page">
      <h1>Your stats</h1>
      <PlanCard plan={plan} hasCandidates={!!planReq} failed={planFailed} />
      <section aria-labelledby="acc-h">
        <h2 id="acc-h">Matches the reference</h2>
        {statsFailed && <p role="status">Cloud stats are temporarily unavailable. Your local progress is still saved.</p>}
        {features && !features.stats && <p>Cloud stats are not configured on this server.</p>}
        {statsFailed ? null : stats ? <AccuracyChart daily={stats.daily} /> : <p>Loading your stats…</p>}
        {stats && stats.items.length > 0 && (
          <>
            <h3>Weakest letters</h3>
            <ul>
              {stats.items.map((i) => (
                <li key={i.item}>{i.item}: matched the reference {Math.round(i.accuracy * 100)}% of {i.attempts} tries</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <NotifySettings enabled={features ? features.notify : undefined} />
    </div>
  );
}
