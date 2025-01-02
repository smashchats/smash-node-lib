# Smash Messaging Library Tutorial

Welcome to the **Smash Messaging Library** tutorial, designed to guide you through the core features of using Smash, from identity creation to participating in neighborhoods. This tutorial follows the **Diataxis framework** and walks you through the "happy path" of the Smash library.

Smash is a decentralized messaging protocol designed to provide secure peer-to-peer communication. Using **Decentralized Identities (DIDs)**, the Smash library enables you to establish identities, send messages, manage profiles, and interact within digital communities called **neighborhoods**.

---

### **Table of Contents**

1. [Prerequisites: Setting Up the Crypto Engine](#1-prerequisites-setting-up-the-crypto-engine)
2. [Identity Creation: Setting Up Decentralized Identifiers (DIDs)](#2-identity-creation-setting-up-decentralized-identifiers-dids)
3. [Messaging Setup: Configuring Smash Messaging](#3-messaging-setup-configuring-smash-messaging)
4. [Peer Communication: Sending and Receiving Messages](#4-peer-communication-sending-and-receiving-messages)
5. [Profile Management: Managing Peer Profiles](#5-profile-management-managing-peer-profiles)
6. [Neighborhoods: Joining and Participating in Neighborhoods](#6-neighborhoods-joining-and-participating-in-neighborhoods)

---

## 1. **Prerequisites: Setting Up the Crypto Engine**

Before we dive into Smash, we need to ensure that our cryptographic engine is set up. Smash depends on the **WebCrypto API** to handle cryptographic operations securely.

### Steps:

1. Import the necessary cryptographic tools.
2. Set up the cryptographic engine for the Smash library.

```ts
import { Crypto } from '@peculiar/webcrypto';

const crypto = new Crypto();
SmashMessaging.setCrypto(crypto);
```

This sets up the engine that will handle all the secure operations in the Smash messaging system.

---

## 2. **Identity Creation: Setting Up Decentralized Identifiers (DIDs)**

In Smash, every peer needs to create their own **Decentralized Identifier (DID)**. A DID contains cryptographic keys used for secure messaging and can be exchanged with other peers to start communicating.

### Steps:

1. **Generate a DID Document**: This document contains Identity Keys (IK) and Exchange Keys (EK).
2. **Serialize the DID** for saving or sharing.

```ts
let didDocumentManager = new DIDDocManager();
const [bobDIDDocument, bobIdentity] = await didDocumentManager.generate();
const bobExportedIdentity = await bobIdentity.serialize();
```

#### Key Concepts:

- **IK (Identity Key)**: Used to sign messages.
- **EK (Exchange Key)**: Used to establish secure communication with others.

**Understanding DID components**:

- `DID`: The unique identifier for the peer.
- `IK & EK`: The keys required for encryption and signing messages.
- **Serialization**: Saving and restoring a DID identity.

---

## 3. **Messaging Setup: Configuring Smash Messaging**

Once the identity is created, you need to configure the **SmashMessaging** library to handle message sending and receiving. This includes setting up communication **endpoints** that act as "mailboxes" for offline messages.

### Steps:

1. **Create a Smash instance**: This is where the identity is connected to the messaging library.
2. **Configure endpoints**: Connect to a server that will handle message routing.

```ts
const preKeyPair = await bobIdentity.generateNewPreKeyPair();
const addedEndpoint = await bob.endpoints.connect(
    {
        url: socketServerUrl,
        smePublicKey: SME_PUBLIC_KEY,
    },
    preKeyPair,
);
```

This sets up the Smash messaging instance and ensures that messages can be routed through the correct endpoints.

---

## 4. **Peer Communication: Sending and Receiving Messages**

Now that the messaging system is set up, you can send messages to other peers. Smash allows for both **sending** and **receiving** messages with automatic delivery confirmations and read receipts.

### Steps:

1. **Send a message**: Create a message and send it to a peer.

```ts
const message = new IMText('Hello, Alice!');
const sent = await bob.send(alice.did, message);
```

2. **Receive a message**: Listen for incoming messages from peers.

```ts
const onBobMessage = jest.fn();
bob.on(IM_CHAT_TEXT, onBobMessage);
```

3. **Message status tracking**: Track the delivery and read status of messages.

```ts
bob.on('status', (status, messages) => {
    console.log(`Message ${status} for:`, messages);
});
```

---

## 5. **Profile Management: Managing Peer Profiles**

Smash automatically shares profiles when peers first interact. This allows you to manage your identity and ensure that your profile information is up-to-date.

### Steps:

1. **Initial profile exchange**: Share profile information with a new peer.
2. **Profile update propagation**: Update and propagate profile changes across peers.

```ts
await alice.updateMeta({ title: 'alice2' });
```

When profiles change, peers automatically share the updated information.

---

## 6. **Neighborhoods: Joining and Participating in Neighborhoods**

Neighborhoods are digital communities where peers can interact. Each neighborhood is managed by a **Neighborhood Admin Bot (NAB)** that handles membership and peer discovery.

### Steps:

1. **Join a neighborhood**: Connect to a neighborhood using the NAB's joining information.
2. **Discover peers in the neighborhood**: Peers can be discovered and interact with each other in a controlled manner.

```ts
await bob.join(await nab.getJoinInfo([testContext.smeConfig]));
```

When joining a neighborhood, events like peer discovery and neighborhood join are triggered.

---

### Summary

This tutorial covers the essential steps to get started with the **Smash Messaging Library**. By following this path, you will learn to:

- Set up a secure cryptographic engine.
- Create and serialize a Decentralized Identity (DID).
- Configure and use the SmashMessaging system.
- Exchange messages with peers.
- Manage peer profiles.
- Join and interact in digital neighborhoods.

For more advanced use cases and edge cases, check out our **How To** and **Reference** sections, which dive deeper into specific features and the inner workings of Smash.
