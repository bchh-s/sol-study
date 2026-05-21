# 4.3 공개키 추출 및 주소 도출

상위 섹션: [4. Q2: KMS Solana 지원 가능 여부](../README.md)

---

## 요약

AWS KMS의 `GetPublicKey` API는 DER (Distinguished Encoding Rules) 인코딩된 SubjectPublicKeyInfo 형식으로 공개키를 반환한다.
이 DER 바이트에서 raw 공개키를 추출하고 체인별 주소를 도출하는 과정을 상세히 비교한다.

---

## 전체 흐름 비교

```
                    AWS KMS GetPublicKey
                           │
                    DER (SubjectPublicKeyInfo)
                           │
               ┌───────────┴───────────┐
               ▼                       ▼
          EVM (secp256k1)         Solana (Ed25519)
               │                       │
     ASN.1 헤더 제거 (23B)      ASN.1 헤더 제거 (12B)
               │                       │
     65B 비압축 공개키            32B raw 공개키
     (04 || x || y)                    │
               │                  base58 인코딩
     04 접두사 제거                     │
               │                  ┌─────────────┐
     64B (x || y)                 │ Solana 주소  │
               │                  │ (32~44자)    │
     keccak256 해시               └─────────────┘
               │
     하위 20바이트 추출
               │
     "0x" + hex 인코딩
               │
     ┌─────────────────┐
     │ Ethereum 주소    │
     │ (42자)           │
     └─────────────────┘
```

---

## DER / SubjectPublicKeyInfo 형식 설명

DER은 ASN.1 (Abstract Syntax Notation One) 데이터를 바이너리로 인코딩하는 규칙이다.
KMS가 반환하는 공개키는 X.509 SubjectPublicKeyInfo 형식을 사용한다.

### SubjectPublicKeyInfo 구조 (RFC 5280)

```asn1
SubjectPublicKeyInfo ::= SEQUENCE {
    algorithm   AlgorithmIdentifier,
    subjectPublicKey  BIT STRING
}

AlgorithmIdentifier ::= SEQUENCE {
    algorithm   OBJECT IDENTIFIER,
    parameters  ANY DEFINED BY algorithm OPTIONAL
}
```

쉽게 말하면: "이 키는 어떤 알고리즘의 키인지" + "실제 키 데이터"를 함께 담는 포맷이다.

---

## Ed25519 DER 공개키 구조 (Solana)

### 전체 바이트 분석

Ed25519의 SubjectPublicKeyInfo는 항상 44바이트이다.

```
바이트 위치   HEX             설명
─────────────────────────────────────────────────
[0]         30              SEQUENCE 태그
[1]         2A              SEQUENCE 길이 (42바이트)
[2]         30              내부 SEQUENCE 태그 (AlgorithmIdentifier)
[3]         05              내부 SEQUENCE 길이 (5바이트)
[4]         06              OID 태그
[5]         03              OID 길이 (3바이트)
[6-8]       2B 65 70        OID 값: 1.3.101.112 (id-EdDSA = Ed25519)
[9]         03              BIT STRING 태그
[10]        21              BIT STRING 길이 (33바이트)
[11]        00              BIT STRING 패딩 비트 수 (0)
[12-43]     xx xx xx ...    실제 Ed25519 공개키 (32바이트)
```

### 12바이트 고정 헤더

```
헤더 (hex): 30 2A 30 05 06 03 2B 65 70 03 21 00
            ─────────────────────────────────────
            이 12바이트는 모든 Ed25519 공개키에서 동일하다!
```

따라서 추출 로직은 매우 단순하다:

```typescript
// Ed25519 DER → raw 공개키 추출
const DER_ED25519_HEADER_LENGTH = 12;
const rawPublicKey = derBytes.slice(DER_ED25519_HEADER_LENGTH); // 32 bytes
```

### 왜 12바이트인가?

```
30 (1B) - SEQUENCE 태그
2A (1B) - SEQUENCE 길이 = 42
30 (1B) - AlgorithmIdentifier SEQUENCE 태그
05 (1B) - AlgorithmIdentifier SEQUENCE 길이 = 5
06 (1B) - OID 태그
03 (1B) - OID 길이 = 3
2B 65 70 (3B) - OID 값 = 1.3.101.112 (Ed25519)
03 (1B) - BIT STRING 태그
21 (1B) - BIT STRING 길이 = 33 (패딩 1B + 키 32B)
00 (1B) - BIT STRING 패딩 비트 = 0
───────
총 12바이트

나머지 32바이트가 실제 Ed25519 공개키이다.
```

### OID 1.3.101.112 의미

```
1          : ISO
1.3        : identified-organization
1.3.101    : thawte (id-EdDSA가 여기 등록됨)
1.3.101.112: id-Ed25519

참고로 Ed448은 1.3.101.113이다.
```

---

## secp256k1 DER 공개키 구조 (EVM)

### 전체 바이트 분석

secp256k1의 SubjectPublicKeyInfo는 88바이트이다 (비압축 공개키 기준).

```
바이트 위치   HEX                     설명
─────────────────────────────────────────────────
[0]         30                      SEQUENCE 태그
[1]         56                      SEQUENCE 길이 (86바이트)
[2]         30                      내부 SEQUENCE 태그
[3]         10                      내부 SEQUENCE 길이 (16바이트)
[4]         06                      OID 태그
[5]         07                      OID 길이 (7바이트)
[6-12]      2A 86 48 CE 3D 02 01    OID: 1.2.840.10045.2.1 (id-ecPublicKey)
[13]        06                      OID 태그 (곡선 파라미터)
[14]        05                      OID 길이 (5바이트)
[15-19]     2B 81 04 00 0A          OID: 1.3.132.0.10 (secp256k1)
[20]        03                      BIT STRING 태그
[21]        42                      BIT STRING 길이 (66바이트)
[22]        00                      패딩 비트 수 (0)
[23]        04                      비압축 포인트 접두사
[24-55]     xx xx ...               x좌표 (32바이트)
[56-87]     xx xx ...               y좌표 (32바이트)
```

### 23바이트 헤더 + 1바이트 접두사

```
헤더 (23B): 30 56 30 10 06 07 2A 86 48 CE 3D 02 01 06 05 2B 81 04 00 0A 03 42 00
접두사 (1B): 04 (비압축 포인트 표시)

→ 23 + 1 = 24바이트를 제거하면 64바이트 (x || y)가 남는다
→ 또는 23바이트를 제거하면 65바이트 (04 || x || y)가 남는다
```

```typescript
// secp256k1 DER → 64바이트 비압축 공개키 추출
const DER_SECP256K1_HEADER_LENGTH = 23;
const uncompressedWithPrefix = derBytes.slice(DER_SECP256K1_HEADER_LENGTH); // 65 bytes (04 + x + y)
const rawPublicKey = uncompressedWithPrefix.slice(1); // 64 bytes (x + y)
```

---

## 주소 도출 과정

### Solana 주소 도출 (3단계)

```
단계 1: KMS GetPublicKey 호출
─────────────────────────────
Input:  KeyId
Output: DER 인코딩된 공개키 (44바이트)
        30 2A 30 05 06 03 2B 65 70 03 21 00 [32바이트 공개키]

단계 2: 헤더 제거
─────────────────
Input:  44바이트 DER
Output: 32바이트 raw 공개키
방법:   slice(12) -- 앞 12바이트 제거

단계 3: Base58 인코딩
─────────────────────
Input:  32바이트 raw 공개키
Output: 32~44자 base58 문자열 = Solana 주소
방법:   bs58.encode(rawPublicKey)

예시:
raw (hex): 7c9e4b5d... (32 bytes)
base58:    9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin
```

### Ethereum 주소 도출 (5단계)

```
단계 1: KMS GetPublicKey 호출
─────────────────────────────
Input:  KeyId
Output: DER 인코딩된 공개키 (88바이트)
        30 56 30 10 ... 04 [64바이트 공개키]

단계 2: 헤더 + 접두사 제거
──────────────────────────
Input:  88바이트 DER
Output: 64바이트 비압축 공개키 (x + y)
방법:   slice(23 + 1) -- 앞 24바이트 제거

단계 3: keccak256 해싱
──────────────────────
Input:  64바이트 공개키
Output: 32바이트 해시
방법:   keccak256(rawPublicKey)

단계 4: 하위 20바이트 추출
─────────────────────────
Input:  32바이트 해시
Output: 20바이트 주소 원본
방법:   hash.slice(-20)

단계 5: Hex 인코딩
─────────────────
Input:  20바이트
Output: 42자 문자열 (0x 접두사 포함)
방법:   "0x" + hex(addressBytes)

예시:
hash (hex): ...742d35cc6634c0532925a3b844bc9e7595f...
address:    0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38

참고: EIP-55 체크섬(대소문자 혼합)은 선택 사항이지만 권장됨.
```

---

## 인코딩 비교: Hex vs Base58

### Hex 인코딩 (EVM)

```
문자 세트: 0-9, a-f (16개 문자)
접두사: "0x"
길이: 42자 (0x + 40자 hex)
체크섬: EIP-55 (대소문자로 체크섬 표현, 선택 사항)

예: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38
    ^^                                        
    접두사   40자 hex = 20 bytes

장점:
- 단순하고 직관적
- 바이트를 바로 읽을 수 있음
- 프로그래밍 언어에서 지원이 보편적

단점:
- 길이가 긴 편 (1 byte = 2 chars)
- 체크섬이 내장되지 않음 (EIP-55는 선택적)
```

### Base58 인코딩 (Solana)

```
문자 세트: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
          (58개 문자 -- 0, O, l, I 제외)
접두사: 없음
길이: 32~44자 (입력 바이트에 따라 가변)
체크섬: Base58Check는 내장 체크섬 포함 (Bitcoin 주소)
        Solana는 순수 Base58 사용 (체크섬 없음)

예: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin
    (44자 = 32 bytes의 base58 표현)

장점:
- 더 짧음 (1 byte ≈ 1.37 chars vs hex의 2 chars)
- 혼동 가능 문자 제거 (0/O, l/I)
- 사람이 읽고 복사하기에 유리

단점:
- 인코딩/디코딩이 hex보다 복잡
- 길이가 가변적 (고정 바이트 수에 대해서도)
- 앞부분 0x00 바이트가 '1'로 표현됨 (특수 규칙)

제외된 문자 이유:
0 (숫자) ↔ O (대문자 O) : 혼동
l (소문자 L) ↔ I (대문자 I) ↔ 1 (숫자) : 혼동
```

### Base58 인코딩 알고리즘

```
1. 입력 바이트 배열을 하나의 큰 정수로 해석한다 (big-endian)
2. 이 정수를 58로 나누면서 나머지를 문자로 매핑한다
3. 앞부분의 0x00 바이트는 각각 '1' 문자로 매핑한다

의사 코드:
function base58Encode(bytes):
    // 선행 제로 바이트 카운트
    leadingZeros = countLeadingZeroBytes(bytes)
    
    // 바이트 → 큰 정수
    num = bytesToBigInt(bytes)
    
    // 58진법 변환
    result = []
    while num > 0:
        remainder = num % 58
        result.push(ALPHABET[remainder])
        num = num / 58
    
    // 선행 제로 처리 + 역순
    return '1'.repeat(leadingZeros) + result.reverse().join('')
```

---

## 실제 코드 예제

### Solana 주소 도출

```typescript
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

// KMS GetPublicKey 응답에서 DER 바이트 추출
const derPublicKey: Uint8Array = kmsResponse.PublicKey!;

// 12바이트 헤더 제거
const rawPublicKey = derPublicKey.slice(12);

// base58 인코딩 = Solana 주소
const address = bs58.encode(rawPublicKey);
console.log(`Solana 주소: ${address}`);

// Solana SDK의 PublicKey 객체로 변환
const pubkey = new PublicKey(rawPublicKey);
console.log(`PublicKey 객체: ${pubkey.toBase58()}`);
// address와 pubkey.toBase58()는 동일해야 한다

// 검증: PublicKey가 유효한 Ed25519 포인트인지 확인
console.log(`On curve: ${PublicKey.isOnCurve(rawPublicKey)}`);
```

### Ethereum 주소 도출

```typescript
import { keccak256 } from 'ethereum-cryptography/keccak';

// KMS GetPublicKey 응답에서 DER 바이트 추출
const derPublicKey: Uint8Array = kmsResponse.PublicKey!;

// 23바이트 헤더 + 1바이트 접두사(04) 제거
const rawPublicKey = derPublicKey.slice(24); // 64 bytes

// keccak256 해시
const hash = keccak256(rawPublicKey); // 32 bytes

// 하위 20바이트 추출 + hex 인코딩
const addressBytes = hash.slice(-20);
const address = '0x' + Buffer.from(addressBytes).toString('hex');
console.log(`Ethereum 주소: ${address}`);
```

---

## 엣지 케이스와 주의사항

### 1. DER 헤더 검증

프로덕션 코드에서는 단순히 slice(12)만 하면 안 된다.
헤더의 OID가 실제로 Ed25519인지 검증해야 한다.

```typescript
const ED25519_DER_HEADER = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
]);

function extractEd25519PublicKey(der: Uint8Array): Uint8Array {
  const header = der.slice(0, 12);
  if (!Buffer.from(header).equals(ED25519_DER_HEADER)) {
    throw new Error('Invalid Ed25519 DER header');
  }
  if (der.length !== 44) {
    throw new Error(`Expected 44 bytes, got ${der.length}`);
  }
  return der.slice(12);
}
```

### 2. Base58 라이브러리 선택

```
npm 패키지 비교:
- bs58 (v5+)  : ESM 지원, Buffer 불필요, Uint8Array 기반. 권장.
- bs58 (v4)   : CommonJS, Buffer 기반. 레거시 호환.
- base-x      : 범용 base 인코딩. bs58가 내부적으로 사용.

Solana SDK (@solana/web3.js)도 내부적으로 bs58를 사용하므로,
별도로 추가하지 않고 SDK의 PublicKey.toBase58()를 사용해도 된다.
```

### 3. Solana 주소 길이가 가변인 이유

```
32바이트를 base58로 인코딩하면 32~44자가 된다.
대부분 43~44자이지만, 앞부분 바이트가 0에 가까우면 더 짧을 수 있다.

이유: base58는 가변 길이 인코딩이다.
log58(2^256) ≈ 43.7 이므로 최대 44자.
선행 0바이트는 '1'로 표현되므로, 주소가 '1'로 시작할 수 있다.

프로그래밍 시 주소 길이를 고정값으로 가정하면 안 된다!
```

## 참고

- [RFC 5280: SubjectPublicKeyInfo](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.7)
- [RFC 8410: Algorithm Identifiers for Ed25519](https://datatracker.ietf.org/doc/html/rfc8410)
- [Base58 인코딩 설명 (Bitcoin Wiki)](https://en.bitcoin.it/wiki/Base58Check_encoding)
- [EIP-55: Mixed-case checksum address encoding](https://eips.ethereum.org/EIPS/eip-55)
