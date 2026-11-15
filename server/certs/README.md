# ISRG Root X1

`isrgrootx1.pem` is the public ISRG Root X1 certificate used by the default OpenVPN client profile. It was exported from the Node.js 20 built-in trust store and verified against the SHA-256 fingerprint `96BCEC06264976F37460779ACF28C5A7CFE8A3C0AAE11A8FFCEE05C0BDDF08C6` published in the [ISRG audit report](https://letsencrypt.org/audits/ISRG-2024-WebTrust-for-CAs-Report.pdf). The official download is [Let's Encrypt's certificate page](https://letsencrypt.org/certificates/).

This certificate is public trust material. If ACME issues from a different trust root, set `OVPN_CA_CERT` to the appropriate PEM file and verify the server certificate chain before deployment.
