import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="fatal" role="alert">
          MinaFlix hit a problem. Reload the page to continue.
        </p>
      );
    }
    return this.props.children;
  }
}
