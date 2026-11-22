import React, { useState } from 'react';
import { Fingerprint, Lock, ShieldCheck } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { apiFetch } from '../lib/api';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';

interface AuthPageProps {
  needsSetup: boolean;
  hasPasskeys: boolean;
  onAuthenticated: () => void;
}

export function AuthPage({ needsSetup, hasPasskeys, onAuthenticated }: AuthPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await apiFetch(needsSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    setError(null);
    setLoading(true);
    try {
      const { challengeId, options } = await apiFetch<{
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>('/api/auth/passkey/login/options', { method: 'POST' });

      const response = await startAuthentication({ optionsJSON: options });
      await apiFetch('/api/auth/passkey/login/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, response }),
      });
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-5 py-10"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <img
            src="/icon.svg"
            alt=""
            className="mx-auto mb-4 h-12 w-12 rounded-2xl shadow-sm"
          />
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            kopi
          </h1>
          {needsSetup && (
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Set up your personal owner account to get started.
            </p>
          )}
        </div>

        <div className="card rounded-2xl p-6">
          {!needsSetup && hasPasskeys && (
            <>
              <Button
                type="button"
                disabled={loading}
                onClick={handlePasskeyLogin}
                variant="default" className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50"
              >
                <Fingerprint className="h-4 w-4" />
                Sign in with Passkey
              </Button>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1" style={{ backgroundColor: 'var(--border-subtle)' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  or use password
                </span>
                <div className="h-px flex-1" style={{ backgroundColor: 'var(--border-subtle)' }} />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="auth-username" className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Username
              </Label>
              <Input
                id="auth-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="auth-password" className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Password
              </Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                required
                minLength={needsSetup ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={needsSetup ? 'At least 8 characters' : undefined}
              />
            </div>

            {needsSetup && (
              <div>
                <Label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Confirm Password
                </Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                />
              </div>
            )}

            {error && (
              <div
                className="rounded-xl px-3.5 py-2.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              variant="default" className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50"
            >
              {needsSetup ? <ShieldCheck className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {loading ? 'Please wait...' : needsSetup ? 'Create Owner Account' : 'Sign In'}
            </Button>
          </form>
        </div>

      </div>
    </div>
  );
}
