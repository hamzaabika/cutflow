# Cutflow MCP server

A small stdio MCP server that connects an external MCP client — Claude
Desktop, Claude Code, or any other — to the project open in **Cutflow**, so
the AI can read the project and propose edits to it.

It is a shim: it speaks the Model Context Protocol on stdio
(newline-delimited JSON-RPC) and translates tool calls to Cutflow's **agent
bridge**, the local REST door built into the app (`electron/bridge.cjs`). It
is plain Node with zero dependencies — no install step.

## Safety model

The bridge's rules apply unchanged, and the shim adds nothing around them:

- The bridge listens on **127.0.0.1 only**, and **only while you enable it**
  in Cutflow (Settings → Agent bridge). While it is off, nothing listens and
  every tool answers with instructions for turning it on.
- Every request carries the bridge's **per-launch token**, which you copy out
  of Settings and hand to the client (see below). Cutflow never writes the
  token to disk; it changes every time the bridge starts.
- AI edits land on **shadow drafts** — private copies of the project pinned
  to a recorded revision. The live project is never changed by a tool call.
- **There is no "accept" tool, on purpose.** You review each draft inside
  Cutflow (top bar → **Agent drafts**) and accept or discard it there.
  Accepting is a compare-and-swap: if you edited the project after the draft
  was made, the stale draft is refused instead of overwriting your work.

## Setup

Three human steps, each time you start a session:

1. **Launch Cutflow** and open the project you want the AI to work on.
2. **Settings → Agent bridge → On.** Leave Cutflow running.
3. **Copy the access token** shown there (there is a copy button) into the
   client configuration below. The address next to it
   (`http://127.0.0.1:47617`) is where the bridge listens; the shim finds the
   port by itself through the discovery file Cutflow writes while the bridge
   is on, so normally only the token goes in the config.

## Client configuration

### Claude Desktop / Claude Code (mcpServers)

```json
{
  "mcpServers": {
    "cutflow": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/clipcraft-v2/mcp-server/cutflow-mcp.mjs"],
      "env": {
        "CUTFLOW_BRIDGE_TOKEN": "PASTE THE TOKEN FROM SETTINGS -> AGENT BRIDGE"
      }
    }
  }
}
```

### Claude Code (CLI shorthand)

```sh
claude mcp add cutflow -e CUTFLOW_BRIDGE_TOKEN=PASTE_TOKEN -- node /ABSOLUTE/PATH/TO/clipcraft-v2/mcp-server/cutflow-mcp.mjs
```

When the bridge restarts (including every Cutflow relaunch with the bridge
left on), the token changes: paste the new one into the config and restart
the client. A stale token answers with exactly that explanation.

### Optional environment overrides

| Variable | Purpose |
| --- | --- |
| `CUTFLOW_BRIDGE_TOKEN` | The bridge token (required). |
| `CUTFLOW_BRIDGE_URL` | Full bridge base URL, e.g. `http://127.0.0.1:47617`. Skips discovery. |
| `CUTFLOW_BRIDGE_PORT` | Bridge port only; the base URL becomes `http://127.0.0.1:<port>`. |
| `CUTFLOW_BRIDGE_FILE` | Path to the bridge discovery file (`bridge.json`). Default: `<userData>/bridge.json` — on Linux `~/.config/ClipCraft/bridge.json`, on macOS `~/Library/Application Support/ClipCraft/bridge.json`, on Windows `%APPDATA%\ClipCraft\bridge.json`. The file holds the port only, never the token. |

## Tools

Read-only (they describe the live project; nothing is created or changed):

| Tool | What it returns |
| --- | --- |
| `cutflow_status` | Bridge status: open project, live revision, pending draft count. |
| `cutflow_get_project` | Project summary: id, name, revision, duration, clip/media counts. |
| `cutflow_get_document` | The full project document (JSON). |
| `cutflow_get_transcript` | Caption sentences with absolute word timings. |
| `cutflow_list_versions` | The project's saved version history. |
| `cutflow_list_derivatives` | Derivative cache state (remux twins, proxies, effect renders). |
| `cutflow_list_shadows` | All shadow drafts with revisions, staleness and op logs. |
| `cutflow_get_shadow` | One draft: status, revisions, op log and its diff vs the base project. |
| `cutflow_get_shadow_document` | A draft's full document, edits included. |
| `cutflow_get_shadow_transcript` | A draft's transcript, edits included. |

Draft editing (shadow-only — the user accepts inside Cutflow):

| Tool | What it does |
| --- | --- |
| `cutflow_create_shadow` | Start a shadow draft pinned to the project's current revision. |
| `cutflow_apply_op` | Apply one edit op to a draft (`dryRun: true` computes the diff and changes nothing). |
| `cutflow_discard_shadow` | Drop one of this client's drafts. |
| `cutflow_refresh_derivatives` | Warm one derivative cache file; never changes the document. |

### Edit operations (`cutflow_apply_op`)

The `op` argument is one of the bridge's four operations:

```jsonc
// Replace the caption text inside [start, end) seconds.
// Word-timed neighbours keep the words outside the range as their own clips.
{ "type": "transcript.setText", "start": 2, "end": 7, "text": "replaced words here" }

// Delete the captions inside a range.
{ "type": "transcript.deleteRange", "start": 10, "end": 12 }

// Assign fields on one clip. "list" is one of videoClips, overlayClips,
// textClips, audioClips, effectClips; the clip's "id" is not patchable.
{ "type": "clip.patch", "list": "audioClips", "clipId": "a1", "patch": { "volume": 0.5 } }

// Replace the whole draft document. The document's "id" must stay the
// open project's id.
{ "type": "document.replace", "project": { "id": "...", "...": "..." } }
```

Every `cutflow_apply_op` call answers with the op's summary and the
structural diff (clips added / removed / changed per track, caption text
changes spelled out), for dry runs and real runs alike.

## Tests

`scripts/test-mcp-shim.mjs` hosts the real bridge against a fake project,
spawns this shim over stdio, and walks the whole flow: handshake, tool list
(including the absence of any accept tool), shadow create → dry-run op →
real op → discard, live-project immutability, and the actionable errors for
a wrong or missing token.

```sh
node scripts/test-mcp-shim.mjs
```
