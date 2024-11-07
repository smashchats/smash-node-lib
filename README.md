## TODO

-   [ ] Implement 'did' prop as ik hash (instead of using did.ik as reference).
-   [ ] Test edge cases (socket error, etc)
-   [ ] Test messaging resilience/reliability

## Trusting

-   Endorsement

{
type: "endorsement",
data: {
content: 'did:key:sjkckjcklm',
endorsement: {
'signer.did': 'signer.sign(content)',
},
},
}

// 'content' is defined by the protocol (in order to display etc etc)

{
endorsements: { 'did':'sig', ... }
}

-   Add to trust wallet
-   Trust wallet -> verify signatures function (N, N+1, count)

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
