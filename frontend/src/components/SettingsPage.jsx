import React, { useState } from "react";
import { api } from "../api.js";

function SecretField({ label, name, field, editing, onToggleEdit, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {!editing && field?.set ? (
        <div className="field__locked">
          <code className="field__masked">{`\u2022\u2022\u2022\u2022 ${field.last4 || ""}`.trim()}</code>
          <span className="field__source">
            stored in {field.source === "env" ? "environment" : "app"}
          </span>
          <button type="button" className="btn-ghost" onClick={onToggleEdit}>
            Update
          </button>
        </div>
      ) : (
        <>
          <input
            type="password"
            name={name}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
          />
          {field?.set && (
            <button type="button" className="btn-ghost field__cancel" onClick={onToggleEdit}>
              Cancel
            </button>
          )}
        </>
      )}
    </label>
  );
}

export default function SettingsPage({ settings, onSaved }) {
  const [targetRepoUrl, setTargetRepoUrl] = useState(settings?.targetRepoUrl || "");
  const [devinApiKey, setDevinApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [editDevin, setEditDevin] = useState(!settings?.devinApiKey?.set);
  const [editGithub, setEditGithub] = useState(!settings?.githubToken?.set);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function save({ triggerAfter }) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const patch = {};
      if (targetRepoUrl !== (settings?.targetRepoUrl || "")) patch.targetRepoUrl = targetRepoUrl;
      if (editDevin && devinApiKey) patch.devinApiKey = devinApiKey;
      if (editGithub && githubToken) patch.githubToken = githubToken;
      const updated = await api.saveSettings(patch);
      setDevinApiKey("");
      setGithubToken("");
      setEditDevin(!updated.devinApiKey.set);
      setEditGithub(!updated.githubToken.set);
      onSaved(updated);
      if (triggerAfter) {
        await api.triggerRun();
        setNotice("Saved. Run triggered.");
      } else {
        setNotice("Saved.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Settings</h1>
          <div className="page__sub">Target repo and API keys for this deployment</div>
        </div>
      </header>

      {error && <div className="banner banner--error">Error: {error}</div>}
      {notice && <div className="banner banner--info">{notice}</div>}

      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ triggerAfter: false });
        }}
      >
        <label className="field">
          <span className="field__label">Target repo URL</span>
          <input
            type="text"
            name="targetRepoUrl"
            value={targetRepoUrl}
            onChange={(e) => setTargetRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            autoComplete="off"
          />
        </label>

        <SecretField
          label="Devin API key"
          name="devinApiKey"
          field={settings?.devinApiKey}
          editing={editDevin}
          onToggleEdit={() => {
            setEditDevin((v) => !v);
            setDevinApiKey("");
          }}
          value={devinApiKey}
          onChange={setDevinApiKey}
          placeholder="Enter new key"
        />

        <SecretField
          label="GitHub token"
          name="githubToken"
          field={settings?.githubToken}
          editing={editGithub}
          onToggleEdit={() => {
            setEditGithub((v) => !v);
            setGithubToken("");
          }}
          value={githubToken}
          onChange={setGithubToken}
          placeholder="ghp_..."
        />

        <div className="settings-form__actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving\u2026" : "Save"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={saving}
            onClick={() => save({ triggerAfter: true })}
          >
            Save &amp; Trigger Run
          </button>
        </div>
      </form>

      <p className="settings-form__note">
        Secrets are encrypted with AES-256-GCM before being stored. Values set here override
        environment variables. Clearing a field falls back to the environment.
      </p>
    </div>
  );
}
