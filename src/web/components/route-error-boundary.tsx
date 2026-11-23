import { Component } from "react";
import type { ReactElement } from "react";

import { RouteErrorCard } from "./route-error-card.tsx";

export class RouteErrorBoundary extends Component<
  { children: ReactElement; insideShell?: boolean },
  { failed: boolean }
> {
  constructor(props: { children: ReactElement; insideShell?: boolean }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <RouteErrorCard
          insideShell={this.props.insideShell === true}
          onRetry={() => {
            globalThis.location.reload();
          }}
        />
      );
    }

    return this.props.children;
  }
}
