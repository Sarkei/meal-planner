import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, LogOut, Plus, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { HouseholdMember } from '../lib/types';

export function HouseholdPage() {
  const { activeHousehold, households, refresh, selectHousehold, user } = useAuth();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    try {
      const data = await api<{ members: HouseholdMember[] }>(`/households/${activeHousehold.id}`);
      setMembers(data.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Haushalt konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeHousehold]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeHousehold) return <p className="card p-6 text-sm text-ink/60">Kein Haushalt vorhanden.</p>;

  const isOwner = activeHousehold.role === 'owner';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeHousehold.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Kopieren hat nicht geklappt — Code bitte manuell abschreiben.');
    }
  };

  const rotateCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ inviteCode: string }>(`/households/${activeHousehold.id}/invite-code`, { method: 'POST' });
      setInfo(`Neuer Code: ${data.inviteCode}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code konnte nicht erneuert werden.');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: HouseholdMember) => {
    if (!window.confirm(`${member.displayName} aus dem Haushalt entfernen?`)) return;
    setBusy(true);
    try {
      await api(`/households/${activeHousehold.id}/members/${member.userId}`, { method: 'DELETE' });
      await load();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mitglied konnte nicht entfernt werden.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!window.confirm(isOwner ? 'Haushalt inklusive Rezepte und Pläne löschen?' : 'Haushalt verlassen?')) return;
    setBusy(true);
    try {
      if (isOwner) await api(`/households/${activeHousehold.id}?force=1`, { method: 'DELETE' });
      else await api(`/households/${activeHousehold.id}/members/${user!.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (joinCode.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ household: { id: string }; alreadyMember: boolean }>('/households/join', {
        method: 'POST',
        body: { code: joinCode.trim() },
      });
      setJoinCode('');
      setInfo(data.alreadyMember ? 'Du bist schon Mitglied dieses Haushalts.' : 'Haushalt beigetreten.');
      await refresh();
      selectHousehold(data.household.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Beitritt fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (newName.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ household: { id: string } }>('/households', {
        method: 'POST',
        body: { name: newName.trim() },
      });
      setNewName('');
      await refresh();
      selectHousehold(data.household.id);
      setInfo('Haushalt angelegt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Haushalt konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="label !mb-0">Aktiver Haushalt</p>
            <h2 className="font-display text-xl font-bold">{activeHousehold.name}</h2>
            <p className="mt-1 text-xs text-ink/50">
              {activeHousehold.memberCount} {activeHousehold.memberCount === 1 ? 'Person' : 'Personen'} ·{' '}
              {activeHousehold.recipeCount} Rezepte · du bist {isOwner ? 'Besitzer' : 'Mitglied'}
            </p>
          </div>
          <div className="rounded-xl border border-dashed border-leaf/40 bg-leaf-soft/50 px-4 py-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-leaf/70">Einladungscode</p>
            <p className="font-display text-2xl font-bold tracking-[0.18em] text-leaf">{activeHousehold.inviteCode}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => void copyCode()}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Kopiert' : 'Kopieren'}
              </button>
              {isOwner && (
                <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => void rotateCode()} disabled={busy}>
                  <RefreshCw className="h-3.5 w-3.5" /> Neu
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink/55">
          Wer diesen Code hat, kann dem Haushalt beitreten und sieht ab dann alle Rezepte und Wochenpläne.
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      {info && <p className="rounded-xl bg-leaf-soft px-3 py-2 text-sm font-medium text-leaf">{info}</p>}

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-leaf" />
          <p className="label !mb-0">Mitglieder</p>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen …
          </p>
        ) : (
          <ul className="divide-y divide-ink/5">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-semibold">
                    {m.displayName}
                    {m.userId === user?.id && <span className="ml-2 text-[11px] font-medium text-ink/40">(du)</span>}
                  </p>
                  <p className="text-[11px] text-ink/45">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="chip">{m.role === 'owner' ? 'Besitzer' : 'Mitglied'}</span>
                  {isOwner && m.role !== 'owner' && (
                    <button
                      className="rounded-lg p-1.5 text-ink/35 hover:bg-red-50 hover:text-clay"
                      onClick={() => void removeMember(m)}
                      aria-label="Mitglied entfernen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-leaf" />
            <p className="label !mb-0">Haushalt beitreten</p>
          </div>
          <input
            className="input tracking-[0.2em] uppercase"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={12}
          />
          <button className="btn btn-ghost w-full" onClick={() => void join()} disabled={busy || joinCode.trim().length < 4}>
            <KeyRound className="h-4 w-4" /> Beitreten
          </button>
        </div>

        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-leaf" />
            <p className="label !mb-0">Neuer Haushalt</p>
          </div>
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="z. B. WG Küche, Familie Nagraszus"
          />
          <button className="btn btn-ghost w-full" onClick={() => void create()} disabled={busy || newName.trim().length < 2}>
            <Plus className="h-4 w-4" /> Anlegen
          </button>
        </div>
      </div>

      {households.length > 1 && (
        <div className="card p-5">
          <p className="label">Meine Haushalte</p>
          <ul className="divide-y divide-ink/5">
            {households.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-semibold">{h.name}</p>
                  <p className="text-[11px] text-ink/45">
                    {h.memberCount} Personen · {h.recipeCount} Rezepte · {h.role === 'owner' ? 'Besitzer' : 'Mitglied'}
                  </p>
                </div>
                {h.id === activeHousehold.id ? (
                  <span className="chip">aktiv</span>
                ) : (
                  <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => selectHousehold(h.id)}>
                    Wechseln
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="btn btn-ghost !text-clay" onClick={() => void leave()} disabled={busy}>
        <LogOut className="h-4 w-4" /> {isOwner ? 'Haushalt löschen' : 'Haushalt verlassen'}
      </button>
    </div>
  );
}
