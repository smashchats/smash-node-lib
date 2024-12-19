# 0.0.0-alpha assumptions

1.  We assume that the user always has one endpoint (SMEv1).
2.  We assume single device usage for now.
3.  At a device level, Endpoints can be uniquely identified by their URL.
4.  We assume that the user has only one NAB.
5.  We assume Messaging Endpoints cache undelivered messages until their expiration time (TBD).

... WIP, not exhaustive.

### Notes

#### ASSUMPTION#3

> At a device level, Endpoints can be uniquely identified by their URL.

This is a simplification that allows us to manage endpoints more easily.

However, in the future we'd want to use a more flexible scheme for URLs.
For example, to allow resolution without relying on centralized DNS.
