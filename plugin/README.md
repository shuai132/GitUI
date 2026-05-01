# GitUI Plugin API

This directory contains the current local plugin API notes and runnable demo plugins.

GitUI plugin v1 is intentionally small:

- Plugins are local folders installed from GitUI Settings -> Plugins.
- Each plugin folder must contain `plugin.json`.
- Enabled plugins can contribute commands to the toolbar Actions menu.
- Commands run through an optional local backend process using JSON-RPC over stdin/stdout.
- Plugins are trusted local code. Install only plugins you understand.

## Demo Plugins

Install any demo by opening GitUI, going to Settings -> Plugins, clicking "Install plugin", and selecting one of these folders:

- `plugin/examples/hello-repo`
- `plugin/examples/worktree-status`
- `plugin/examples/branch-summary`

After enabling the plugin, open the toolbar Actions menu or right-click a commit and use the Plugins submenu.

If you already installed a demo before editing these files, uninstall that demo in GitUI and install the demo folder again. GitUI copies plugin folders into the app data directory during installation, so installed plugins do not update live from this repository.

All demos use Node.js with no npm dependencies.

## Manifest

Every plugin has a `plugin.json` file:

```json
{
  "api_version": 1,
  "id": "com.example.hello-repo",
  "name": "Hello Repo",
  "version": "0.1.0",
  "description": "Shows the current repository context.",
  "backend": {
    "command": "node",
    "args": ["backend.mjs"]
  },
  "permissions": [
    "git:read",
    {
      "id": "process:run",
      "reason": "Runs the demo backend."
    }
  ],
  "contributes": {
    "commands": [
      {
        "id": "hello.showRepo",
        "label": "Show current repo",
        "category": "Demo",
        "description": "Displays the active repo path."
      }
    ],
    "menus": [
      {
        "location": "toolbar.actions",
        "command": "hello.showRepo"
      }
    ]
  }
}
```

### Top-level Fields

- `api_version`: Required. Current value is `1`.
- `id`: Required. Stable plugin id. Use letters, numbers, `.`, `_`, and `-`.
- `name`: Required. Display name.
- `version`: Required. Plugin version string.
- `description`: Optional. Shown in the plugin settings list.
- `entry`: Optional. Reserved for future iframe panels.
- `backend`: Optional. Local process used to execute commands.
- `permissions`: Optional. Strings or `{ "id", "reason" }` objects.
- `contributes`: Optional object containing commands, menus, panels, and settings.

### Backend

`backend.command` is executed with `backend.args` in the installed plugin folder.

```json
{
  "backend": {
    "command": "node",
    "args": ["backend.mjs"]
  }
}
```

The backend process should:

1. Read one JSON-RPC request from stdin.
2. Execute the requested command.
3. Write a JSON-RPC response to stdout.
4. Exit.

## Commands

Commands are declared under `contributes.commands`.

```json
{
  "id": "demo.command",
  "label": "Run demo command",
  "category": "Demo",
  "description": "Optional tooltip text."
}
```

- `id`: Required. Command id unique inside the plugin.
- `label`: Required. Menu label.
- `category`: Optional. GitUI prefixes the menu label as `Category: Label`.
- `description`: Optional. Used as a menu tooltip.
- `enablement`: Optional. Reserved for future conditional visibility.

## Menus

Menus are declared under `contributes.menus`.

```json
{
  "location": "toolbar.actions",
  "command": "demo.command"
}
```

Currently supported locations:

- `toolbar.actions`: Toolbar Actions -> Plugins submenu.
- `commit.context`: Commit row context menu -> Plugins submenu.

`commit.context` commands receive commit selection data:

```json
{
  "type": "commit",
  "oid": "full commit oid",
  "short_oid": "short oid",
  "message": "full commit message",
  "summary": "first line",
  "author_name": "Author",
  "author_email": "author@example.com",
  "author_time": 1234567890,
  "time": 1234567890,
  "parent_oids": ["parent oid"],
  "is_unreachable": false,
  "is_stash": false,
  "is_reflog_tip": false
}
```

## Backend Protocol

GitUI sends:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "execute_command",
  "params": {
    "command_id": "demo.command",
    "context": {
      "repo_id": "repo uuid",
      "repo_path": "/absolute/path/to/repo",
      "selection": null
    }
  }
}
```

The backend returns:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "message": "Done",
    "refresh": ["workspace"]
  }
}
```

`result.message` is shown as a success toast.

`result.refresh` can include:

- `workspace`: refresh working tree status.
- `history`: reload commit history.
- `branches`: reload branch data.

For failures, return:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "message": "What went wrong"
  }
}
```

GitUI also accepts a plain command result without the JSON-RPC wrapper:

```json
{
  "message": "Done",
  "refresh": []
}
```

## Minimal Backend Template

```js
import process from 'node:process'

const input = await new Promise((resolve) => {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { raw += chunk })
  process.stdin.on('end', () => resolve(raw))
})

const request = JSON.parse(input)
const { command_id, context } = request.params

const result = {
  message: `${command_id} ran in ${context.repo_path ?? 'no repo'}`,
  refresh: []
}

process.stdout.write(JSON.stringify({
  jsonrpc: '2.0',
  id: request.id,
  result
}))
```

## Current Limits

- No plugin marketplace or signing yet.
- No iframe panels or plugin settings rendering yet.
- No runtime permission enforcement yet; permissions are declared and displayed.
- No long-running persistent plugin process yet; each command starts a backend process.
- No direct access to GitUI internals, Vue components, Pinia stores, or Tauri `invoke`.
