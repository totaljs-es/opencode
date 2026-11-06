# Total.js Totem: design

Totem is an AI coding environment written as a Total.js 5 application. You open a project, talk to an agent that reads the code, edits files and runs commands, and review what changed. The same application runs from a terminal, in a Docker container and inside a native window.

These pages describe what we are going to build before it exists. They are the contract for the code: when the code and a page disagree, one of them is a bug.

| Page | What it answers |
|---|---|
| [Vision](vision.md) | What Totem is, who it is for, what it will not do |
| [Architecture](architecture.md) | Folders, processes, the request path, how Total.js features are used |
| [Agent loop and tools](agent-loop.md) | How a prompt becomes edits; tools as actions |
| [Data model](data-model.md) | Projects, sessions, messages, parts, snapshots and where they live |
| [Protocol](protocol.md) | REST endpoints and the WebSocket events the interface speaks |
| [Permissions and security](security.md) | What the agent may do, what it asks for, how the server is protected |
| [Interface](interface.md) | Screens and the jComponent components they use |
| [Capabilities](capabilities.md) | The list of features, each with its phase |
| [Delivery](delivery.md) | Command line, Docker image and native windows |
| [Roadmap](roadmap.md) | Phases, each with the condition that closes it |
| [Decisions](decisions.md) | Decisions taken and the ones still open |

## How to read the status of a statement

- **Verified** statements about Total.js name the file of the framework that supports them.
- Everything else is a **design**: a proposal that the first phase turns into code or corrects.
- Open questions live only in [decisions](decisions.md).
