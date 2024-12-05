# Contributing to Smash-Node-Lib

Thank you for your interest in contributing to the **Smash Protocol** and **Smash-Node-Lib**! :sparkles:

**All the code you contribute is owned by YOU and contributed in the public domain under the terms of our [LICENSE](../LICENSE) (extended AGPL-3.0).**

Read our [CODE OF CONDUCT](./CODE_OF_CONDUCT.md) to keep our community approachable and respectable.
We also encourage you to read more about our project [values](https://dev.smashchats.com/Smash%20Values) and [principles](https://dev.smashchats.com/Smash%20Principles) before contributing.

This guide outlines the contribution workflow, explains key tools and processes, and provides resources to get started. We value your time and efforts in making Smash Protocol better for everyone.

<!-- TODO: issues from non-radicle contributors -->

---

## **Table of Contents**

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
    - [Creating a Radicle Identity](#creating-a-radicle-identity)
    - [Cloning the Repository](#cloning-the-repository)
3. [Making Changes](#making-changes)
    - [Using Radicle Patches](#using-radicle-patches)
4. [Issues](#issues)
5. [Resources](#resources)
6. [Licensing](#licensing)

---

## **Code of Conduct**

We follow the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md) to ensure an open, welcoming, and respectful community. Please read it before you start contributing.

We don't use any CLAs (Contributor License Agreements), therefore you are free to contribute to the project under your own name. <br>
**All the code you contribute is owned by you and contributed in the public domain under the terms of our [License](../LICENSE) (extended AGPL-3.0).**

## **Getting Started**

### Creating a Radicle Identity

We use [Radicle](https://radicle.xyz/)—a decentralized Git collaboration network—for code management and contributions. Before contributing, you need a Radicle identity (DID).

#### Steps to Create a Radicle Identity:

1. Install Radicle:
    ```bash
    curl -sSf https://radicle.xyz/install | sh
    ```
2. Create a new identity or log in:
    ```bash
    rad auth
    ```

For a complete guide, visit the [Radicle User Documentation](https://radicle.xyz/guides/user).

### Cloning the Repository

The Smash-Node-Lib repository is **currently private**.
You’ll need to request access from a maintainer by contacting [contribute@smashchats.com](mailto:contribute@smashchats.com).

#### Using Radicle:

1. Connect to Smash’s seeding node:

    > Last updated: 2024-12-05.
    > Find an up-to-date list of seeding nodes [here](https://dev.smashchats.com/radicle%20seeding%20node).

    ```bash
    rad node connect z6MkiXzPZSV6yx6wHSdSPNpVVytxauiLzhU1jG8sVmxdZkcn@rad-node.smashchats.com:8778
    ```

2. Clone the repository:

    > Last updated: 2024-12-05.
    > Find an up-to-date list of repositories IDs [here](https://dev.smashchats.com/radicle%20repos).

    ```bash
    rad clone rad:zZ6oTFp8JrVyhEQmrcfkQkQgmoQJ
    ```

#### Using GitHub (Mirror):

Alternatively, you can request access to the [GitHub mirror](https://github.com/unstaticlabs/smash-node-lib) and clone it:

```bash
git clone https://github.com/unstaticlabs/smash-node-lib.git
```

## **Making Changes**

We use Radicle Patches for collaboration instead of GitHub Pull Requests (PRs).
A patch is a local-first, decentralized way to propose and review changes.

### Using Radicle Patches

1. **Create a Branch**:

    ```bash
    git checkout -b feat/my-feature
    ```

2. **Make Changes**:
   Edit your files and commit changes:

    ```bash
    git add .
    git commit -m "Description of changes"
    ```

3. **Propose a Patch**:
   Push your changes to the `refs/patches` branch:

    ```bash
    git push rad HEAD:refs/patches
    ```

4. **Update an Existing Patch**:
   Amend or add new commits, then force-push:

    ```bash
    git commit --amend  # or add new commits
    git push --force    # update the patch
    ```

5. **Review and Merge**:
   Maintainers will review your patch.
   Approved patches are merged into the _default branch_ using Git.

    > The current default branch is `v0.0.0-alpha` (updated: 2024-12-05).

## **Issues**

We manage issues through the `rad` CLI.
A web interface for browsing issues will be introduced later.

### Working with Issues:

1. List all open issues:
    ```bash
    rad issue
    ```
2. Open a new issue:
    ```bash
    rad issue open
    ```
3. Comment on an issue:
    ```bash
    rad issue comment <id>
    ```
4. Close an issue:
    ```bash
    rad issue state <id> --closed # or --solved
    ```

## **Resources**

Here are some resources to help you contribute effectively:

- [Smash Protocol Developer Notes](https://dev.smashchats.com/)
- [Smash Developers Telegram Group](https://t.me/+kbJ8MNR1tjViZjdk)
- [Radicle Documentation](https://radicle.xyz/docs/)
- [Project README](../README.md)

## **Licensing**

All contributions to Smash-Node-Lib are made under our extended [AGPL-3.0 License](../LICENSE). By contributing, you agree to license your work under these terms.
