// AI cost / placement badge (gap-build Stream E, AI-02): one pill next to
// the button that spends money or sends media, saying where the work runs,
// what it bills, and — when the job size is known — what this run costs.
// Props: featureId (src/aiCost.js), minutes (audio length, for per-minute
// billing), chars (text length, for quota billing), detail (extra line, e.g.
// the remaining ElevenLabs quota). Local features render green, cloud amber,
// online-free blue-grey; nothing here is a tooltip-only hint — the cost is
// in the open before the user clicks.
import React from 'react';
import { aiCost, estimateCost, placementLabel } from '../aiCost.js';

export default function AiCostBadge({ featureId, minutes, chars, detail }) {
  const f = aiCost(featureId);
  if (!f) return null;
  const est = estimateCost(featureId, { minutes, chars });
  const cls = f.placement === 'local' ? 'ai-badge local' : f.placement === 'cloud' ? 'ai-badge cloud' : 'ai-badge net';
  return (
    <span className={cls} data-testid="ai-cost-badge" data-feature={featureId} data-placement={f.placement}
      title={`${f.label}. ${f.note}${f.rateNote ? ` ${f.rateNote}` : ''}`}>
      <span className="ai-badge-place">{placementLabel(f.placement)}</span>
      {est && <span className="ai-badge-est">{est.text}</span>}
      {f.needsKey && <span className="ai-badge-key">Needs your API key</span>}
      {f.sendsMedia && <span className="ai-badge-media">Sends media off-device</span>}
      {detail && <span className="ai-badge-detail">{detail}</span>}
    </span>
  );
}
