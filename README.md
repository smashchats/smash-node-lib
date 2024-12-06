# Smash-Node-Lib

This ES Module library provides the core functionality for implementing and interacting with the **Smash Protocol**—a modular, **1:N social messaging** and **curated content-sharing** protocol.
It powers the free and open digital neighborhoods of tomorrow, promoting decentralization, interoperability, and user ownership.

![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/smashchatsdev/237cf77f566685841725f2001c1987f7/raw/jest-coverage-comment__main.json)

<!-- ![License](https://img.shields.io/github/license/unstaticlabs/smash-node-lib)
![Version](https://img.shields.io/github/package-json/v/unstaticlabs/smash-node-lib) -->

---

## **Table of Contents**

1. [Introduction](#introduction)
2. [Features](#features)
3. [Getting Started](#getting-started)
4. [Usage](#usage)
5. [Development Guide](#development-guide)
6. [References](#references)
7. [Contributing](#contributing)
8. [License](#license)

---

## **Introduction**

The Smash Protocol enables secure, decentralized communication and content sharing without intermediaries. Smash-Node-Lib is an open-source library for building JavaScript-based clients, plugins, or microservices that interact with the protocol.

**Key Principles**:

- **Open Standards**: Fully modular and built on open APIs for interoperability.
- **Decentralization**: Peer-to-peer communication with no central authority.
- **User Ownership**: Your data, your rules.

For more details, see the full [documentation](./docs/README.md).

## **Features**

> Smash-Node-Lib is currently in the alpha stage of development.
> The Smash Protocol is not yet fully functional.

- **1:N Messaging**: Support for both one-on-one and group communications.
- **Neighborhood-Based Organization**: Join or create digital communities with unique rules and curation.
- **Modular Design**: Built as microservices for flexibility and extensibility.
- **Secure Communication**: Signal Protocol implementation ensures privacy.
- **Open APIs**: Integrate seamlessly with other applications or build your own clients.
- **AT Protocol**: Integrate with the AT Protocol for decentralized identity and social networking.

## **Getting Started**

Follow these steps to start using the Smash-Node-Lib:

1. **Clone the Repository**:

Using Radicle:

> **WARNING**: The Smash-Node-Lib repository is currently private.
> You'll need to ask a maintainer to add you to the 'allow list'.
> Read more in our [CONTRIBUTING.md](./docs/CONTRIBUTING.md).

```bash
rad clone rad:zZ6oTFp8JrVyhEQmrcfkQkQgmoQJ # RID for the Smash-Node-Lib repo
```

> You can find an updated list of all Smash's repository IDs (RIDs) on our [developer notes](https://dev.smashchats.com/radicle%20repos).

Using our GitHub mirror repository:

> **WARNING**: The Smash-Node-Lib repository is currently private.
> You'll need to ask a maintainer to grant you access to the repository.
> Read more in our [CONTRIBUTING.md](./docs/CONTRIBUTING.md).

```bash
git clone https://github.com/unstaticlabs/smash-node-lib.git
```

2. **Install Dependencies**:

```bash
npm install
```

3. **Set Up Your Development Environment**:

- [Create a Radicle Identity](https://radicle.xyz/guides/user#come-into-being-from-the-elliptic-aether).
- Connect to the Smash seeding node:

```bash
rad node connect z6MkiXzPZSV6yx6wHSdSPNpVVytxauiLzhU1jG8sVmxdZkcn@rad-node.smashchats.com:8778
```

> You can find a list of all Smash's seeding nodes on our [developer notes](https://dev.smashchats.com/radicle%20seeding%20node).

4. **Run All Test Suites**:

Looking at tests is a great way to understand how to use the library.
Tests have been written using [Jest](https://jestjs.io/) and designed to provide a comprehensive set of examples on interacting with the `Smash-Node-Lib` library.

```bash
npm test
```

## **Usage**

> **WARNING**: The Smash-Node-Lib has not yet been published.
> The following examples are not yet fully functional.

**ATTENTION**: Have a look at our 'Smash Simple Neighborhood' repository for a working example of how to use the `Smash-Node-Lib` library in its current state.

### **Process unhandledRejections**

Handle errors gracefully in your application:

```typescript
const logger: Logger = ...;
process.on('unhandledRejection', (reason, promise) => {
    SmashMessaging.handleError(reason, promise, logger);
});
```

## **References**

- [Signal Protocol](https://github.com/PeculiarVentures/2key-ratchet): Secure communication library used in Smash-Node-Lib (Peculiar Ventures implementation of the [Signal Protocol](https://signal.org/docs/)).
- [Socket.io Client API](https://socket.io/docs/v4/client-api/): WebSocket communication.
- [Radicle Documentation](https://radicle.xyz/docs/): Decentralized code collaboration.

## **Contributing**

We welcome contributions from the community! Check out our [Contributing Guide](./docs/CONTRIBUTING.md) to get started. Ensure adherence to our [Code of Conduct](./docs/CODE_OF_CONDUCT.md).

Contributions are managed through [Radicle](https://radicle.xyz/), a decentralized Git collaboration network. Learn more in our [CONTRIBUTING.md](./docs/CONTRIBUTING.md).

## **License**

This project is licensed under our own extended **AGPL-3.0**. See the [LICENSE](./LICENSE) file for details.

## **Contact**

- **Developer Chat**: Smash Developers Telegram Group (request access to maintainers)
- **Security Issues**: [security@smashchats.com](mailto:security@smashchats.com)
- **Email**: [contribute@smashchats.com](mailto:contribute@smashchats.com)
