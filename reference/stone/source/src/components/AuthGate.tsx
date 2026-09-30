"use client";

import React, { useState, useEffect } from "react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const auth = localStorage.getItem("app_authenticated");
    if (auth === "true") {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    // Artificially delay slightly for a premium feedback transition
    setTimeout(() => {
      if (password === "Factory@1234") {
        localStorage.setItem("app_authenticated", "true");
        setIsAuthenticated(true);
      } else {
        setError("Invalid access password. Please try again.");
        setIsLoading(false);
      }
    }, 600);
  };

  if (isAuthenticated === null) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-spinner" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-root">
        {/* Glow Spheres */}
        <div className="auth-glow auth-glow-1" />
        <div className="auth-glow auth-glow-2" />

        <div className="auth-card">
          <header className="auth-header">
            <div className="auth-logo">M</div>
            <h1>Magppie Inventory</h1>
            <p>Enter the factory authorization password to access the BOM Backorder Dashboard.</p>
          </header>

          <form onSubmit={handleLogin} className="auth-form">
            <div className="auth-field">
              <label htmlFor="auth-password">Security Password</label>
              <input
                id="auth-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="auth-error-bubble">
                <span className="auth-error-icon">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="auth-submit-btn" disabled={isLoading}>
              {isLoading ? (
                <div className="auth-btn-spinner" />
              ) : (
                <>
                  <span>Verify Authorization</span>
                  <span className="auth-btn-arrow">→</span>
                </>
              )}
            </button>
          </form>

          <footer className="auth-footer">
            <p>© 2026 Magppie Living Pvt Ltd. All rights reserved.</p>
          </footer>
        </div>

        <style jsx global>{`
          .auth-loading-screen {
            display: flex;
            height: 100vh;
            width: 100vw;
            align-items: center;
            justify-content: center;
            background: #090a0f;
          }

          .auth-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(255, 255, 255, 0.05);
            border-top: 3px solid #0f766e;
            border-radius: 50%;
            animation: auth-spin 1s linear infinite;
          }

          @keyframes auth-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .auth-root {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #07080c;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow: hidden;
            z-index: 99999;
          }

          .auth-glow {
            position: absolute;
            width: 500px;
            height: 500px;
            border-radius: 50%;
            filter: blur(120px);
            opacity: 0.15;
            pointer-events: none;
            z-index: 1;
          }

          .auth-glow-1 {
            background: #0f766e;
            top: -100px;
            left: -100px;
          }

          .auth-glow-2 {
            background: #8b5cf6;
            bottom: -100px;
            right: -100px;
          }

          .auth-card {
            position: relative;
            background: rgba(255, 255, 255, 0.02);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 24px;
            padding: 48px 40px;
            width: min(460px, 92vw);
            box-shadow: 
              0 30px 60px rgba(0, 0, 0, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.1);
            z-index: 2;
            animation: auth-fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }

          @keyframes auth-fade-in {
            from {
              opacity: 0;
              transform: translateY(16px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }

          .auth-header {
            text-align: center;
            margin-bottom: 36px;
          }

          .auth-logo {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 54px;
            height: 54px;
            background: linear-gradient(135deg, #0f766e, #14b8a6);
            color: #fff;
            font-size: 24px;
            font-weight: 800;
            border-radius: 14px;
            margin-bottom: 20px;
            box-shadow: 0 8px 20px rgba(15, 118, 110, 0.3);
          }

          .auth-header h1 {
            color: #f3f4f6;
            font-size: 24px;
            font-weight: 700;
            margin: 0 0 10px 0;
            letter-spacing: -0.02em;
          }

          .auth-header p {
            color: #9ca3af;
            font-size: 14px;
            line-height: 1.5;
            margin: 0;
          }

          .auth-form {
            display: grid;
            gap: 24px;
          }

          .auth-field {
            display: grid;
            gap: 8px;
          }

          .auth-field label {
            color: #d1d5db;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .auth-field input {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            color: #f9fafb;
            font-size: 16px;
            height: 50px;
            padding: 0 16px;
            width: 100%;
            transition: all 0.2s ease;
            outline: none;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
          }

          .auth-field input:focus {
            background: rgba(255, 255, 255, 0.05);
            border-color: #0f766e;
            box-shadow: 
              inset 0 2px 4px rgba(0, 0, 0, 0.2),
              0 0 0 4px rgba(15, 118, 110, 0.15);
          }

          .auth-error-bubble {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 12px;
            color: #fca5a5;
            font-size: 13px;
            padding: 12px 16px;
            animation: auth-shake 0.35s ease;
          }

          @keyframes auth-shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-6px); }
            50% { transform: translateX(4px); }
            75% { transform: translateX(-4px); }
          }

          .auth-error-icon {
            font-size: 16px;
            flex-shrink: 0;
          }

          .auth-submit-btn {
            position: relative;
            background: linear-gradient(135deg, #0f766e, #115e59);
            border: none;
            border-radius: 12px;
            color: #fff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            font-weight: 600;
            height: 50px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(15, 118, 110, 0.2);
          }

          .auth-submit-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 18px rgba(15, 118, 110, 0.3);
            filter: brightness(1.1);
          }

          .auth-submit-btn:active:not(:disabled) {
            transform: translateY(0);
          }

          .auth-submit-btn:disabled {
            opacity: 0.8;
            cursor: not-allowed;
          }

          .auth-btn-arrow {
            margin-left: 8px;
            transition: transform 0.2s ease;
          }

          .auth-submit-btn:hover .auth-btn-arrow {
            transform: translateX(3px);
          }

          .auth-btn-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-top: 2px solid #fff;
            border-radius: 50%;
            animation: auth-spin 0.8s linear infinite;
          }

          .auth-footer {
            margin-top: 36px;
            text-align: center;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 20px;
          }

          .auth-footer p {
            color: #4b5563;
            font-size: 11px;
            margin: 0;
            letter-spacing: 0.02em;
          }
        `}</style>
      </div>
    );
  }

  return <>{children}</>;
}
