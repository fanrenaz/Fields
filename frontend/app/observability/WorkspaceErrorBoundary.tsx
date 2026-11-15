import { Empty } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { CircleX } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { withTranslation, type WithTranslation } from "react-i18next";

import { workspaceTelemetry } from "./workspace-telemetry";

type Props = WithTranslation & { children: ReactNode };
type State = { failed: boolean };

/** Deliberately generic: browser telemetry records no exception content. */
class WorkspaceErrorBoundaryBase extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    workspaceTelemetry.recordReactError();
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Empty
        action={<Button onClick={() => this.setState({ failed: false })}>{this.props.t("common.retry")}</Button>}
        icon={CircleX}
        title={this.props.t("common.unexpectedError")}
        type="page"
      />
    );
  }
}

export const WorkspaceErrorBoundary = withTranslation()(WorkspaceErrorBoundaryBase);
