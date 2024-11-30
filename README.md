## TODO

-   [x] Implement 'did' prop as ik hash (instead of using did.ik as reference). --> `did.id`
-   [ ] Test edge cases (socket error, etc)
-   [ ] Test messaging resilience/reliability
-   [x] Replace all occurences of SHA1 with SHA256
-   [ ] use a more generic typing for messages (eg, AT Records???)
-   [ ] integrate pseudo code below into codebase & refreshed specs (!!)
        --> [ ] MOVE LATEST SPECS AS MD TO dev.smashchats.com NOTES

```typescript
interface Message {
    type: string;
    version?: string; // semantic versioning
    data: any;
}

interface SmashTextMessage {
    type: 'com.smashchats.message.text';
    data: string;
}

interface SmashProfileMessage {
    type: 'com.smashchats.profile';
    data: SmashProfile;
}
```

## Trusting

Badges & Endorsements -> Own separate subprotocols

-   [ ] refactor Smash specs

### Trust Wallet

-   Add to trust wallet
-   Trust wallet -> verify signatures function (N, N+1, count)

#### Crypto Wallet

<Later>

### Endorsements

```json
{
    "type": "endorsement",
    "data": {
        "uri": "<eg, at://<did>/<type>/<cid>>",
        "did": "<signer.did>",
        "signature": "<signer.sign(uri)>"
    }
}
```

> **CID is Content-addressable ID!!**

> the URI value is defined by the protocol (in order to display etc etc)
> eg, 'at://did:plc:44ybard66vv44zksje25o7dz/com.smashchats.badge.verified/3jwdwj2ctlk26'
> read more at: https://atproto.com/specs/at-uri-scheme

```typescript
type UserDID = string;
type ContentSignature = string;

interface Endorsable {
    endorsed: Record<UserDID, ContentSignature>;
}
```

#### Profile endorsement

read as "I am endorsing this profile";

> can mean "I have met them in person" and/or "I trust them" ...

```json
{
    "type": "endorsement",
    "data": {
        "uri": "at://did:key:jksjbbnjnbs",
        "did": "did:plc:jnsjnsjndjksckj",
        "signature": "knskjnsdkjndsqlkdqslkqdslk"
    }
}
```

on the client side, they SHOULD

1. Show count of endorsement with a way to display more precise information
2. Verify signatures in the background and append verified trust chain to bage info
3. Show "verifying..." as long as not done. can take time to resolve all keys & signature.
4. Show trusted verified signatures with an explanation of the trust chain

```text
profile "title" (<did>)
    title
    description
    endorsed by 13, including (ℹ️, closable overlay)
        ✅ "known-trusted peer , user-given name"
        and 3 others in your web of trust (ℹ️, floating overlay)
            your web of trust is made of your trusted peers
            and their own trusted peers.
    badges
        "Size": 178cm (endorsed by 8, ℹ️, closable overlay)
                ✅ "known-trusted peer , user-given name"
                and 1 other in your web of trust (ℹ️, floating overlay)
                    your web of trust is made of your trusted peers
                    and their own trusted peers.
```

> on the client side: prioritized queue of crypto work!!

    --> crypto is compute expensive and can involve blocking operations.
    --> implement a prioritized cancellable queue

> eg: when getting messages, decrypt them priority 1 , endorsements 2, badges 3, etc.

### Smash Badges

> > > IS THERE AN EXISTING SPEC/SUBPROTO WE COULD REUSE HERE INSTEAD???

Assets are AT Records (blob etc) and should be collectable as an NFT (ERC 721).
Smash Badges are a type of Assets.
Assets should be compatible with erc-721. // what does it mean? ; and https://atproto.com/specs/record-key

```json
{
    "type": "com.smashchats.badge",
    "data": {
        "name": "app.kinkhub.body.height",
        "type": "com.smashchats.types.units.size.cm",
        "value": 178,
        "signed": {},
        "endorsed": {}
    }
}
```

<!-- TODO: can we REUSE AT proto/Bsky profile for META? -->

<!-- TODO: should we split messages: profile.did; profile.meta; profile.badges; profile.media; ... -->

```json
{
    "type": "com.smashchats.profile",
    "data": {
        "did": {
            "id": "did:key:sjbncsbhjcsnbk",
            "ik": "djksqcbnjkvscknjb"
        },
        "meta": {
            "title": "<title>",
            "picture": "<base64:encoded>"
        },
        "badges": [
            {
                "name": "app.kinkhub.body.height",
                "type": "com.smashchats.types.units.size.cm",
                "value": 178,
                "signed": {
                    // DO WE NEED/WANT THIS??? (maybe not at first anyway, wait for use case)
                    "<signer.did>": "<sig>" // DO WE NEED/WANT THIS??? (maybe not at first anyway, wait for use case)
                }, // DO WE NEED/WANT THIS??? (maybe not at first anyway, wait for use case)
                "endorsed": {
                    "<signer.did>": "<sig>"
                }
            }
        ],
        "media": [],
        "endorsed": {
            "<signer.did>": "<sig>"
        }
    }
}
```

> http://cm.size.units.types.smashchats.com/ may redirect to spec, eg, dev.smashchats.com/types/units/size/cm/
> dev.smashchats.com/types/units/size/cm/ explains how to interpret/display , and convert from other unit types
> IS THAT SOMETHING THAT ALREADY EXISTS??? COULD WE REUSE EXISTING SPECS/IMPLEMENTATIONS????

```json
{
    "type": "com.smashchats.media.base64",
    "data": "<base64:encoded>"
}
```

> on the client side, should MAP "type" providers with type "resolvers"

```typescript
interface Resolver<T, R?T> {
    constructor(protected data: T, protected version?: string = "1.0.0");
    get value(): R;
}

class StringDecoderResolver implements Resolver<string> {
    private value: string;
    constructor(data, version, private encoding: string) {
        this.value = return Buffer.from(data, encoding);
    }
    get value() {
        return this.value;
    }
}

class Base64Resolver implements Resolver<string> {
    constructor(data: string) {
        super(data, "base64");
    }
}

class GenericSmashUser extends EventEmitter {
    private resolvers: Record<string, {
        resolver: Resolver,
        event?: string,
    }> = {};

    constructor() {
        // GenericSmashUser implements generic event names: text, reaction, badge, profile, etc.
        this.on('message', this.handleMessage.bind(this));
        // GenericSmashUser implements generic resolvers
        this.registerTypeResolver("com.smashchats.media.base64", Base64Resolver, "media");
    }

    registerTypeResolver(type: string, resolver: Resolver, event?: string) {
        this.resolvers[type] = { resolver, event };
    }

    private handleMessage(sender: SmashDID, message: Message) {
        // forward event to parent (duplicate)
        super.emit('message', sender, message);
        // resolve resolver if exists
        if (Object.hasOwnProperty(this.resolvers, message.type)) {
            const { resolver, event } = this.resolvers[message.type];
            this.emit(event??message.type, new resolver(message.data).value);
        }
    }
}
```

> eg, implement that "com.smashchats.media.base64" is resolved using Base64(data);
> eg, other types can reuse resolvers , eg "com.test.base64" could also use Base64(data);

## Random notes and references

https://github.com/PeculiarVentures/webcrypto-docs/blob/master/CRYPTO_STORAGE.md
https://github.com/PeculiarVentures/graphene

https://github.com/opendnssec/SoftHSMv2
https://github.com/opendnssec/SoftHSMv2/blob/develop/README.md

https://cloud.google.com/kms/docs/reference/pkcs11-library
https://www.npmjs.com/package/node-webcrypto-p11

https://github.com/PeculiarVentures/2key-ratchet/

https://socket.io/docs/v4/client-api/

apt-get update
apt-get install -y --no-install-recommends git
apt-get install -y --no-install-recommends openssl
apt-get install -y --no-install-recommends sqlite3 libp11-kit-dev automake autoconf libtool pkg-config
git clone https://github.com/opendnssec/SoftHSMv2.git /tmp/softhsm2
cd /tmp/softhsm2
sh autogen.sh
./configure --prefix=/usr/local --with-crypto-backend=openssl
make
sudo make install
mkdir -p /usr/local/var/lib/softhsm/tokens/

### Dev docs notes

#### Process unhandledRejections

process.on('unhandledRejection', (reason, promise) => {
SmashMessaging.handleError(reason, promise, this.logger);
});
