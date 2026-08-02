import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <pre style={{
          position: "fixed", inset: 0, background: "#fff", color: "#a00",
          padding: 16, fontSize: 12, whiteSpace: "pre-wrap", overflow: "auto",
          zIndex: 99999, fontFamily: "monospace",
        }}>
          App crashed:{"\n\n"}
          {this.state.error.stack || this.state.error.message || String(this.state.error)}
        </pre>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
