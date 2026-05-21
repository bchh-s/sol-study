# 4.1 키/서명 알고리즘 비교: secp256k1 (ECDSA) vs Ed25519 (EdDSA)

상위 섹션: [4. Q2: KMS Solana 지원 가능 여부](../README.md)

---

## 요약

EVM과 Solana는 서로 다른 타원곡선 암호를 사용한다.
이 차이가 KMS 설정, 공개키 추출, 주소 도출, 서명 워크플로우 전반에 영향을 준다.

| 항목 | EVM | Solana |
|------|-----|--------|
| 타원곡선 | secp256k1 (Koblitz curve) | Ed25519 (Edwards curve) |
| 서명 방식 | ECDSA (랜덤 nonce 사용) | EdDSA (결정적, 동일 입력 = 동일 서명) |
| 개인키 크기 | 32 bytes | 32 bytes (seed) 또는 64 bytes (seed+pubkey) |
| 공개키 크기 | 64 bytes (비압축) / 33 bytes (압축) | 32 bytes |
| 서명 크기 | 65 bytes (r=32, s=32, v=1) | 64 bytes (R=32, s=32) |
| 주소 길이 | 20 bytes -> 42자 hex (0x 포함) | 32 bytes -> 32~44자 base58 |
| 주소 = 공개키? | 아니요 (keccak256 해시의 하위 20바이트) | 예 (공개키 = 주소) |
| BIP-44 경로 | `m/44'/60'/0'/0/0` | `m/44'/501'/0'/0'` |

---

## 타원곡선 비교

### secp256k1 (Koblitz Curve)

```
곡선 방정식: y^2 = x^3 + 7  (mod p)
p = 2^256 - 2^32 - 977

특징:
- 비트코인이 처음 채택, 이더리움이 따라감
- Weierstrass 형태의 곡선
- NIST 표준이 아님 (NSA 백도어 의혹 회피 목적)
- 소프트웨어 구현이 상대적으로 복잡
- 상수가 단순해서 "nothing-up-my-sleeve" 성질을 가짐
```

### Ed25519 (Edwards Curve)

```
곡선 방정식: -x^2 + y^2 = 1 + d*x^2*y^2  (mod p)
p = 2^255 - 19
d = -121665/121666

특징:
- Daniel J. Bernstein이 설계 (2011)
- Twisted Edwards 형태의 곡선
- 128-bit 보안 수준 (secp256k1과 동등)
- 하드웨어/소프트웨어 구현에서 더 빠름
- 사이드 채널 공격에 강한 구조적 특성
```

### 보안 수준 비교

두 곡선 모두 약 128-bit 보안 수준을 제공한다.
즉, 무차별 대입(brute force)으로 키를 깨려면 약 2^128번의 연산이 필요하다.
현재 기술로는 어떤 곡선도 깨지지 않는다.

```
보안 수준 비교:
secp256k1:  ~128-bit security  (256-bit key)
Ed25519:    ~128-bit security  (256-bit key = 2^255 - 19)
AES-128:    ~128-bit security  (참고: 대칭 암호 동등 수준)
```

---

## 서명 방식 비교: ECDSA vs EdDSA

### ECDSA (Elliptic Curve Digital Signature Algorithm)

```
서명 과정:
1. 메시지 m의 해시 e = H(m) 계산
2. 랜덤 nonce k 생성  ← ★ 핵심: 매번 새로운 난수가 필요
3. 곡선 위의 점 (x1, y1) = k * G 계산
4. r = x1 mod n 계산
5. s = k^(-1) * (e + r * privateKey) mod n 계산
6. 서명 = (r, s)
7. EVM은 recovery id v를 추가: 서명 = (r, s, v)  ← 65 bytes

검증 과정:
1. 서명 (r, s)와 메시지 해시 e로부터 공개키 복원
2. 복원된 공개키와 알려진 공개키 비교
3. EVM에서는 ecrecover(hash, v, r, s) → address 로 검증
```

**ECDSA의 nonce 문제:**

```
위험 시나리오:
1. nonce k가 노출되면 → private key 계산 가능
   privateKey = (s * k - e) * r^(-1) mod n

2. 동일 nonce를 두 번 사용하면 → private key 계산 가능
   두 서명 (r, s1), (r, s2)로부터:
   k = (e1 - e2) * (s1 - s2)^(-1) mod n
   → privateKey 노출

실제 사고 사례:
- 2010년 Sony PS3 ECDSA nonce 재사용 → 마스터키 유출
- 일부 비트코인 지갑에서 약한 RNG로 nonce 생성 → 자금 탈취
```

RFC 6979는 결정적 nonce 생성을 제안하여 이 문제를 완화했지만,
구현체가 RFC 6979를 정확히 따르는지 검증해야 하는 부담이 있다.

### EdDSA (Edwards-curve Digital Signature Algorithm)

```
서명 과정:
1. 개인키 seed에서 확장: (a, prefix) = SHA-512(seed)
   a = 스칼라 (실제 개인키)
   prefix = 32바이트 (nonce 생성에 사용)
2. 결정적 nonce: r = SHA-512(prefix || message)  ← ★ 핵심: 난수 불필요!
3. 곡선 위의 점 R = r * B 계산
4. k = SHA-512(R || publicKey || message) 계산
5. S = (r + k * a) mod l 계산
6. 서명 = (R, S)  ← 64 bytes

검증 과정:
1. k = SHA-512(R || publicKey || message) 계산
2. S * B == R + k * publicKey 인지 확인
```

**EdDSA의 결정적 서명:**

```
핵심 차이:
- nonce r이 (prefix || message)의 해시로 결정됨
- 동일 메시지에 대해 항상 동일한 서명 생성
- 외부 난수 생성기(RNG)에 의존하지 않음
- nonce 재사용 문제가 구조적으로 불가능

결과:
- 테스트가 용이 (동일 입력 → 동일 출력)
- 사이드 채널 공격 표면 감소
- RNG 품질에 대한 걱정 없음
```

---

## Solana가 Ed25519를 선택한 이유

### 1. 결정적 서명 (Deterministic Signatures)

```
ECDSA: sign(message, privateKey, randomNonce) → 매번 다른 서명
EdDSA: sign(message, privateKey)              → 항상 같은 서명

→ RNG 취약점으로 인한 키 유출 위험이 원천 차단된다.
→ 테스트와 디버깅이 쉽다 (같은 입력 = 같은 출력).
```

### 2. 빠른 검증 속도

```
벤치마크 (일반적 수치):
- ECDSA 검증: ~1.5ms per signature
- EdDSA 검증: ~0.5ms per signature (약 3배 빠름)

Solana는 초당 수천 개의 트랜잭션을 처리해야 한다.
각 트랜잭션에 1개 이상의 서명이 포함되므로, 검증 속도가 처리량에 직접 영향을 준다.
Ed25519의 빠른 검증은 Solana의 고성능 목표에 필수적이다.
```

### 3. 배치 검증 (Batch Verification) 가능

```
Ed25519는 여러 서명을 한 번에 검증하는 배치 검증을 지원한다.
n개의 서명을 개별 검증하면 O(n)이지만,
배치 검증을 사용하면 상수 계수가 크게 줄어든다.

Solana 블록에 수천 개의 트랜잭션이 포함될 때,
배치 검증은 validator의 처리 속도를 크게 향상시킨다.
```

### 4. nonce 취약점 원천 차단

```
ECDSA의 최대 위험은 약한 nonce이다.
- 잘못된 RNG → nonce 예측 가능 → private key 유출
- nonce 재사용 → 두 서명으로 private key 계산 가능

Ed25519는 nonce를 메시지와 개인키로부터 결정적으로 유도하므로,
이 공격 벡터가 아예 존재하지 않는다.
```

### 5. 단순한 공개키/주소 구조

```
EVM:    공개키(64B) → keccak256 → 하위 20바이트 → hex → 0x742d35Cc6634...
Solana: 공개키(32B) = 주소 → base58 → 7xKXtg2CW87d95...

Solana의 단순한 구조:
- 주소에서 공개키를 직접 알 수 있어 서명 검증이 즉시 가능
- 해싱 단계가 없어 주소 도출이 빠름
- 주소 충돌(collision) 위험이 없음 (해시 잘림이 없으므로)
```

---

## 키 크기 및 서명 크기 상세

### 개인키

```
secp256k1 (EVM):
- 32 bytes (256 bits) 순수 스칼라 값
- 범위: 1 ~ n-1 (n = 곡선 차수)
- 예: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

Ed25519 (Solana):
- 32 bytes seed (CLI/지갑에서 사용하는 형태)
- 또는 64 bytes expanded (seed 32B + public key 32B)
- Solana CLI의 keypair.json은 64바이트 형태를 저장함
- KMS에서는 seed만 내부에 보관, 공개키는 GetPublicKey로 추출
```

### 공개키

```
secp256k1 (EVM):
- 비압축: 65 bytes (04 || x(32B) || y(32B))
  - 04는 비압축 포인트 접두사
- 압축: 33 bytes (02/03 || x(32B))
  - 02: y가 짝수, 03: y가 홀수
- EVM에서는 비압축 형태(04 제외한 64바이트)를 keccak256에 입력

Ed25519 (Solana):
- 항상 32 bytes (압축/비압축 구분 없음)
- Edwards 곡선의 y좌표 + x의 부호 비트 1개 = 총 256 bits
- 이 32바이트가 곧 Solana 주소
```

### 서명

```
ECDSA (EVM):
- r: 32 bytes (곡선 위 점의 x좌표)
- s: 32 bytes (서명 스칼라)
- v: 1 byte (recovery id, 27 또는 28)
- 총 65 bytes
- DER 인코딩 시 70~72 bytes (가변 길이)
- KMS는 DER 형태로 반환 → r,s 파싱 필요

EdDSA (Solana):
- R: 32 bytes (곡선 위 점, 압축)
- S: 32 bytes (스칼라)
- 총 64 bytes (항상 고정)
- KMS는 이 64바이트를 그대로 반환
```

---

## BIP-44 파생 경로 (Derivation Path)

BIP-44는 HD 지갑에서 키를 계층적으로 파생하는 표준이다.
형식: `m / purpose' / coin_type' / account' / change / address_index`

### EVM (Ethereum)

```
경로: m/44'/60'/0'/0/0

- 44'     : BIP-44 목적 (고정)
- 60'     : Ethereum의 coin type (SLIP-44 등록번호)
- 0'      : 첫 번째 계정
- 0       : 외부 체인 (0=외부, 1=잔돈)
- 0       : 첫 번째 주소

대부분의 EVM 지갑이 이 경로를 사용:
MetaMask, Ledger, Trezor 등
```

### Solana

```
경로: m/44'/501'/0'/0'

- 44'     : BIP-44 목적 (고정)
- 501'    : Solana의 coin type (SLIP-44 등록번호)
- 0'      : 첫 번째 계정
- 0'      : 첫 번째 주소 (hardened)

주의: Solana는 마지막 인덱스도 hardened(')로 사용한다.
EVM은 m/44'/60'/0'/0/0 (마지막 두 레벨이 non-hardened)
Solana는 m/44'/501'/0'/0' (전체 hardened)

이유: Ed25519는 non-hardened 파생을 지원하지 않는 구현이 많다.
non-hardened 파생은 부모 공개키로부터 자식 공개키를 유도할 수 있게 해주는데,
Ed25519의 수학적 구조에서는 이를 안전하게 구현하기 어렵다.
```

### KMS에서의 파생 경로

```
중요: AWS KMS는 BIP-44 파생 경로를 사용하지 않는다!

KMS는 각 키를 독립적으로 생성한다.
HD 지갑처럼 하나의 seed로부터 계층적으로 키를 파생하는 구조가 아니다.

KMS에서의 키 관리:
- 각 키는 고유한 KeyId (UUID 또는 ARN)를 가진다
- 키 간에 수학적 관계가 없다
- alias를 사용해 논리적 그룹핑을 한다

예:
- alias/dagaon-evm-hot-wallet-001 → KeyId: abc123...
- alias/dagaon-sol-hot-wallet-001 → KeyId: def456...

BIP-44 경로는 사용자 지갑(MetaMask, Phantom 등)에서
시드 구문(mnemonic)으로부터 키를 파생할 때만 관련된다.
커스터디 서비스(Dagaon Core)는 KMS의 독립 키 관리를 사용한다.
```

---

## Dagaon Core 적용 시 고려사항

### 1. 서명 포맷 파싱

```typescript
// EVM: KMS가 DER 인코딩된 서명을 반환한다
// → r, s를 파싱하고 v(recovery id)를 계산해야 한다
const derSignature = kmsSignResponse.Signature; // DER 인코딩
const { r, s } = parseDerSignature(derSignature);
const v = calculateRecoveryId(hash, r, s, publicKey); // 27 또는 28

// Solana: KMS가 64바이트 raw 서명을 반환한다
// → 파싱 없이 그대로 사용
const rawSignature = kmsSignResponse.Signature; // 64 bytes
// 그대로 트랜잭션에 첨부
```

### 2. 서명 결정성 활용

```
Ed25519의 결정적 서명을 활용하면:
- 재시도 로직을 단순화할 수 있다 (같은 메시지 → 같은 서명)
- 멱등성(idempotency) 검증이 쉽다
- golden test(고정 입력 → 고정 출력)로 회귀 테스트가 가능하다
```

### 3. 검증 로직

```
EVM에서는 서명자 주소 검증을 위해 ecrecover가 필요하다.
Solana에서는 공개키(=주소)로 직접 서명 검증이 가능하다.

이는 온체인 검증뿐 아니라 Dagaon Core 내부의
서명 후 검증(sign-then-verify) 로직에도 영향을 준다.
```

## 참고

- [RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA)](https://datatracker.ietf.org/doc/html/rfc8032)
- [SEC 2: Recommended Elliptic Curve Domain Parameters](https://www.secg.org/sec2-v2.pdf)
- [SLIP-44: Registered coin types for BIP-44](https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
- [BIP-44 Multi-Account Hierarchy](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)
