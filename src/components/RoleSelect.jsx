// Role picker (P2-23, AU-09) — which mix bus a clip's sound belongs to:
// Dialogue / Music / SFX / Ambience. Shared by the audio-track inspector
// and the picture-clip inspector's audio tab; the choice dispatches
// setClipRole, and the smart default (picture → dialogue, audio → music)
// shows when no role was set explicitly.
import React from 'react';
import { useT } from '../i18n/index.jsx';
import { AUDIO_ROLES, ROLE_NAMES, roleOf } from '../mixer.js';

export default function RoleSelect({ clip, track, dispatch }) {
  const t = useT();
  return (
    <label className="field row">
      <span>{t('insp.role')}</span>
      <select value={roleOf(clip, track)} aria-label={t('insp.role')}
        onChange={(e) => dispatch({ type: 'setClipRole', track, id: clip.id, role: e.target.value })}>
        {AUDIO_ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
      </select>
    </label>
  );
}
