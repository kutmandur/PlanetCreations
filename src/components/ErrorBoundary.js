import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error: error };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleTryAgain = () => {
    // Reset the error state to attempt to re-render the child components
    this.setState({ hasError: false, error: null });
    // For navigation errors, reloading the page is a robust way to recover
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="container mx-auto p-8 text-center bg-red-50 border border-red-200 rounded-lg">
          <h1 className="text-2xl font-bold text-red-700">Something went wrong.</h1>
          <p className="mt-2 text-gray-600">An error occurred while trying to load this page.</p>
          {this.state.error && (
            <pre className="mt-4 p-2 text-left bg-gray-100 text-red-800 text-xs rounded overflow-auto">
              <code>{this.state.error.toString()}</code>
            </pre>
          )}
          <button
            onClick={this.handleTryAgain}
            className="mt-6 bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;