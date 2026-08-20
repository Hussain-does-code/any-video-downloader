---
name: stitch_ui_designer
description: Expert Stitch UI/UX design and screen generation workflow. Use whenever creating, designing, wireframing, styling, or generating project UIs, landing pages, dashboards, mobile/web screens, and design systems using StitchMCP.
---

# 🎨 STITCH UI/UX DESIGN & GENERATION ENGINE

This skill provides complete operational instructions for using **StitchMCP** to design, generate, refine, and extract state-of-the-art user interfaces and design systems.

---

## 🚀 When to Activate This Skill
* Designing new screens, dashboards, landing pages, or web/mobile layouts.
* Creating or updating design systems, color tokens, typography, and component styling.
* Generating UI variants to explore different visual aesthetics or layouts.
* Refining existing screens with targeted design edits.
* Converting generated Stitch designs into clean, production-grade local frontend code.

---

## 🛠️ MCP Tool Calling Convention

All StitchMCP tools are called via the `call_mcp_tool` tool with `ServerName: "StitchMCP"`:

```json
{
  "ServerName": "StitchMCP",
  "ToolName": "<tool_name>",
  "Arguments": { ... }
}
```

---

## 📋 Complete Tool Calling Workflows

### 1. Project Management
* **Create Project**:
  ```json
  {
    "ServerName": "StitchMCP",
    "ToolName": "create_project",
    "Arguments": {
      "title": "Modern Video Downloader UI"
    }
  }
  ```
* **List Projects**:
  ```json
  {
    "ServerName": "StitchMCP",
    "ToolName": "list_projects",
    "Arguments": {
      "filter": "view=owned"
    }
  }
  ```
* **Get Project Details**:
  ```json
  {
    "ServerName": "StitchMCP",
    "ToolName": "get_project",
    "Arguments": {
      "name": "projects/<PROJECT_ID>"
    }
  }
  ```

---

### 2. Screen Generation (`generate_screen_from_text`)
Generates high-fidelity screens from rich prompts.

```json
{
  "ServerName": "StitchMCP",
  "ToolName": "generate_screen_from_text",
  "Arguments": {
    "projectId": "<PROJECT_ID>",
    "prompt": "Create a sleek, modern dark-mode video downloader dashboard with glassmorphism cards, glowing cyan/purple accents, URL input bar with paste button, format selector dropdowns (MP4, MP3, 4K, 1080p), real-time progress card with download speed meters, active download queue table, and history list.",
    "deviceType": "DESKTOP",
    "modelId": "GEMINI_3_1_PRO"
  }
}
```

* **Device Types**: `DESKTOP`, `MOBILE`, `TABLET`, `AGNOSTIC`
* **Models**: `GEMINI_3_1_PRO` (recommended), `GEMINI_3_FLASH`

> [!IMPORTANT]
> Generation can take 1–3 minutes. If the tool call encounters a timeout, **do not retry immediately**. Call `list_screens` or `get_screen` to check if generation succeeded in the background.

---

### 3. Variant Exploration (`generate_variants`)
Explores multiple design directions and aesthetic variations.

```json
{
  "ServerName": "StitchMCP",
  "ToolName": "generate_variants",
  "Arguments": {
    "projectId": "<PROJECT_ID>",
    "selectedScreenIds": ["<SCREEN_ID>"],
    "prompt": "Explore a futuristic cyberpunk aesthetic with neon accents and high contrast",
    "variantOptions": {
      "variantCount": 3,
      "creativeRange": "EXPLORE",
      "aspects": ["LAYOUT", "COLOR_SCHEME", "IMAGES"]
    },
    "deviceType": "DESKTOP",
    "modelId": "GEMINI_3_1_PRO"
  }
}
```

* **Creative Ranges**: `REFINE` (subtle), `EXPLORE` (balanced), `REIMAGINE` (radical)
* **Aspects**: `LAYOUT`, `COLOR_SCHEME`, `IMAGES`, `TEXT_FONT`, `TEXT_CONTENT`

---

### 4. Screen Editing & Polishing (`edit_screens`)
Applies surgical design edits to existing screens.

```json
{
  "ServerName": "StitchMCP",
  "ToolName": "edit_screens",
  "Arguments": {
    "projectId": "<PROJECT_ID>",
    "selectedScreenIds": ["<SCREEN_ID>"],
    "prompt": "Increase contrast of the download buttons, add subtle pill badges for video quality tags (4K, HD, HQ), and make the download progress bar dynamic with animated gradient fill.",
    "deviceType": "DESKTOP",
    "modelId": "GEMINI_3_1_PRO"
  }
}
```

---

### 5. Design Systems & Token Synchronization
* **Upload `DESIGN.md` & Create System**:
  ```json
  {
    "ServerName": "StitchMCP",
    "ToolName": "upload_design_md",
    "Arguments": {
      "projectId": "<PROJECT_ID>",
      "designMdBase64": "<BASE64_STRING>"
    }
  }
  ```
* **Apply Design System to Screens**:
  ```json
  {
    "ServerName": "StitchMCP",
    "ToolName": "apply_design_system",
    "Arguments": {
      "projectId": "<PROJECT_ID>",
      "assetId": "<DESIGN_SYSTEM_ASSET_ID>",
      "selectedScreenInstances": [
        {
          "id": "<SCREEN_INSTANCE_ID>",
          "sourceScreen": "projects/<PROJECT_ID>/screens/<SCREEN_ID>"
        }
      ]
    }
  }
  ```

---

### 6. Screen Retrieval & Production Integration
* Fetch screen code & HTML/CSS assets:
  ```json
  {
    "ServerName": "StitchMCP",
    "ToolName": "get_screen",
    "Arguments": {
      "name": "projects/<PROJECT_ID>/screens/<SCREEN_ID>"
    }
  }
  ```
* **Local Integration Protocol**:
  1. Extract structural HTML5 elements and component layouts.
  2. Implement unified CSS custom properties for theme colors, gradients, and elevation.
  3. Wire interactive handlers (buttons, inputs, state managers, event listeners).
  4. Ensure full responsiveness across all screen breakpoints (mobile, tablet, desktop).
