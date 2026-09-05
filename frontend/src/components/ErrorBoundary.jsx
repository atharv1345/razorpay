import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-8 panel p-6 text-coral-alert">
          <h2 className="font-display text-xl">Dashboard section failed</h2>
          <p className="mt-2 text-sm text-slate-300">{this.state.error.message}</p>
          <button
            className="mt-4 rounded-lg bg-mint-500/20 px-3 py-2 text-mint-400"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
