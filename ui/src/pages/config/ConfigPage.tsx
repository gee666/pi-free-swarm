import { useParams } from "react-router-dom";
import type { ConfigurationChange } from "../../../../src/runtime-configuration";
import { requestConfigurationChange } from "../../api/configuration";
import { BudgetDetails } from "../../components/BudgetSummary";
import { ConfigurationDetails } from "../../components/ConfigurationDetails";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { RuntimeConfigEditor } from "./RuntimeConfigEditor";
import { useRuntimeConfiguration } from "./useRuntimeConfiguration";
import styles from "./Config.module.css";

function describeChange(change: ConfigurationChange): string {
  switch (change.type) {
    case "addAgents":
      return `Add ${change.count} workers`;
    case "removeAgent":
      return `Remove ${change.name}`;
    case "retireAgent":
      return `Replace ${change.name} after handoff`;
    case "raiseBudget":
      return "Raise budget ceilings";
  }
}

export function ConfigPage() {
  const { id = "" } = useParams();
  const state = useRuntimeConfiguration(id);
  const view = state.data;
  const request = async (change: ConfigurationChange) => {
    if (!view) throw new Error("Configuration is still loading.");
    try {
      const updated = await requestConfigurationChange(id, view.run, view.revision, change);
      state.update((current) => (current && current.revision > updated.revision ? current : updated));
    } finally {
      // A failed response does not prove a write failed. Refresh status without replaying the request.
      state.reload();
    }
  };
  return (
    <Panel aria-label="Swarm configuration" className={styles.page}>
      <PanelHeader title="Swarm configuration" />
      <PanelBody className={styles.details}>
        {state.error && <ErrorBanner>{`Could not load configuration: ${state.error.message}`}</ErrorBanner>}
        {!view ? (
          !state.error && <SkeletonRows />
        ) : (
          <>
            <p>
              Runtime configuration revision {view.revision}. Changes affect this swarm only, not project or global
              settings.
            </p>
            <RuntimeConfigEditor
              workers={view.configuration?.effective.workers.map((model) => ({ name: model.name, model })) ?? []}
              budget={view.configuration?.effective.budget ?? null}
              maxAgents={view.configuration?.effective.limits.maxAgents}
              disabled={
                !view.configuration ||
                state.loading ||
                view.requests.some(
                  (request) =>
                    request.run === view.run && (request.status === "pending" || request.status === "applying"),
                )
              }
              onAdd={(count) => request({ type: "addAgents", count })}
              onRemove={(name) => request({ type: "removeAgent", name })}
              onRaiseBudget={(patch) => request({ type: "raiseBudget", ...patch })}
            />
            <h3>Recent change requests</h3>
            {view.requests.length === 0 ? (
              <p>No runtime changes requested.</p>
            ) : (
              <ul aria-label="Configuration change requests">
                {view.requests.map((request) => (
                  <li key={request.id}>
                    #{request.id} {describeChange(request.change)}: {request.status}
                    <p>
                      Run {request.run} · requested by {request.requestedBy}
                    </p>
                    {request.error && <p>{request.error}</p>}
                  </li>
                ))}
              </ul>
            )}
            <ConfigurationDetails configuration={view.configuration} />
            <BudgetDetails budget={view.budget} />
            <h3>Changes requiring a new run</h3>
            <p>
              Models, thinking levels, credentials, launch extensions, task criteria and RPC frame limits are not edited
              live here.
            </p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
