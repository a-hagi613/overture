import { Component } from "react";
import type { ReactElement } from "react";

import { RouteErrorCard } from "./route-error-card.tsx";

export class RouteErrorBoundary extends Component<{ children: ReactElement }, { failed: boolean }> {
  constructor(props: { children: ReactElement }) {
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
          onRetry={() => {
            globalThis.location.reload();
          }}
        />
      );
    }

    return this.props.children;
  }
}
