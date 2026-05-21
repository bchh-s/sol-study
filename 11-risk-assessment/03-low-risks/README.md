# 낮은 리스크

상위 섹션: [11. 리스크 평가](../README.md)

---

## Risk 7: KMS 통합

### 근본 원인

Solana는 Ed25519 서명 알고리즘을 사용한다. AWS KMS는 2025년 11월부터 Ed25519 키를 공식 지원(GA)하므로, Dagaon Core의 기존 KMS 통합 레이어에 새로운 키 타입을 추가하면 된다.

### 영향도: LOW

- KMS 통합 실패 시 서명 불가 → 출금 불가
- 그러나 AWS 공식 지원 + 커뮤니티 라이브러리 존재로 실패 가능성 매우 낮음

### 발생 확률: LOW

- AWS KMS Ed25519는 GA 상태 (프리뷰가 아님)
- `solana-kms-signer` 등 검증된 라이브러리 존재
- 표준 AWS SDK 작업으로 구현 가능

### 기존 EVM KMS 통합과의 비교

| 항목 | EVM (secp256k1) | Solana (Ed25519) |
|------|----------------|-----------------|
| AWS KMS 키 타입 | `ECC_SECG_P256K1` | `ECC_EDWARDS_ED25519` |
| 서명 방식 | `ECDSA_SHA_256` | `EDDSA_SHA_512_ED25519` |
| 공개키 형식 | DER → 압축 해제 → keccak256 → 주소 | DER → raw 32bytes → base58 → 주소 |
| 서명 형식 | DER → r, s, v 분리 | raw 64 bytes (r ∥ s) |
| SDK 호출 | `Sign(MessageType: DIGEST)` | `Sign(MessageType: RAW)` |
| 지연 시간 | ~50-200ms | ~50-200ms (동일) |

### 구현 사항

#### 키 생성

```
AWS SDK 호출:
  CreateKey({
    KeySpec: 'ECC_EDWARDS_ED25519',
    KeyUsage: 'SIGN_VERIFY',
    Description: 'Solana hot wallet key',
    Tags: [{ Key: 'chain', Value: 'solana' }]
  })
```

#### 공개키 추출 및 주소 변환

```
1. GetPublicKey(KeyId) → DER 인코딩된 공개키
2. DER 파싱 → raw 32-byte Ed25519 공개키 추출
   (DER 헤더 제거: SubjectPublicKeyInfo 구조에서 BIT STRING 내용 추출)
3. raw 32 bytes → base58 인코딩 → Solana 주소
   (Ed25519 공개키 자체가 Solana 주소)
```

#### 서명

```
1. Solana TX 메시지 직렬화 (serialize message bytes)
2. Sign({
     KeyId: keyId,
     Message: messageBytes,        // TX 메시지 원본 (해시 아님!)
     MessageType: 'RAW',           // EVM의 DIGEST와 다름
     SigningAlgorithm: 'EDDSA_SHA_512_ED25519'
   })
3. 반환된 서명(64 bytes)을 TX에 첨부
```

**중요한 차이: EVM에서는 메시지 해시(DIGEST)를 서명하지만, Ed25519에서는 원본 메시지(RAW)를 서명한다.** KMS가 내부적으로 SHA-512 해싱을 수행한다.

#### 서명 검증 (테스트용)

```
Verify({
  KeyId: keyId,
  Message: messageBytes,
  Signature: signatureBytes,
  MessageType: 'RAW',
  SigningAlgorithm: 'EDDSA_SHA_512_ED25519'
})
```

### 잠재적 문제와 대응

| 문제 | 가능성 | 대응 |
|------|--------|------|
| AWS 리전별 가용성 | 낮음 (GA 후 전체 리전 지원) | 사용 리전에서 CLI로 사전 검증 |
| KMS 응답 지연 | 낮음 (p99 < 300ms) | timeout 설정 + 재시도 (최대 3회) |
| KMS 서비스 장애 | 매우 낮음 | multi-region KMS 키 복제 |
| DER 파싱 오류 | 낮음 | golden test (고정 키 → 고정 주소 검증) |
| 요금 | 무시 가능 | $1/key/month + $0.03/10,000 API calls |

### 검증 체크리스트

- [ ] 사용 AWS 리전에서 Ed25519 키 생성 확인
- [ ] 공개키 → Solana 주소 변환 golden test
- [ ] 서명 → 검증 round-trip test
- [ ] devnet에서 KMS 서명으로 SOL 전송 성공
- [ ] KMS 호출 지연 시간 측정 (p50, p99)

---

## Risk 8: Finalized 레벨에서의 Reorg

### 근본 원인

블록체인의 reorg(재구성)는 확정된 블록이 다른 포크로 대체되는 현상이다. EVM 체인에서는 12-15 confirmation 후에도 이론적으로 reorg가 가능하지만, Solana의 `finalized` commitment에서는 reorg가 사실상 불가능하다.

### Solana가 Reorg에 안전한 이유: Tower BFT

Solana의 합의 메커니즘인 Tower BFT는 **지수적 lockout** 규칙을 사용한다:

```
Validator의 투표 lockout:

투표 1: 2 슬롯 lockout
투표 2: 4 슬롯 lockout
투표 3: 8 슬롯 lockout
...
투표 N: 2^N 슬롯 lockout
투표 31: 2^31 = 2,147,483,648 슬롯 lockout (~27년)

finalized = 전체 스테이크의 2/3 이상이 투표한 블록

reorg을 위해서는:
1. 2/3 이상의 validator가 이전 투표를 번복해야 함
2. 투표 번복 시 lockout 기간 동안 보상 상실
3. 경제적 손실이 reorg으로 얻을 수 있는 이익을 압도적으로 초과
```

### 영향도: LOW (이론적)

- 만약 발생한다면: 입금으로 인정한 TX가 사라짐 → 이중 지불
- 그러나 Solana 역사상 finalized 블록의 reorg는 **단 한 번도 관측된 적 없음**

### 발생 확률: LOW (사실상 0)

- Solana mainnet 운영 5년 이상 finalized reorg 0건
- 경제적으로 불가능: 전체 스테이크의 2/3 통제 필요 (수십억 달러 상당)
- EVM과 비교: Ethereum은 finality gadget(Casper FFG) 도입 전에도 드물었고, 도입 후에는 Solana와 유사하게 경제적 보장

### 방어적 구현 (Defense-in-Depth)

reorg가 사실상 불가능하더라도, 방어적 프로그래밍 원칙에 따라 최소한의 검증 로직을 유지한다:

#### previousBlockhash 연속성 검증

```
Block Publisher가 새 블록을 처리할 때:

1. getBlock(slot) → block.previousBlockhash 확인
2. DB에서 이전 처리 블록의 blockhash 조회
3. block.previousBlockhash === 이전 블록의 blockhash ? → 정상
4. 불일치 시:
   - REORG_DETECTED 이벤트 발행 (이론상)
   - 불일치 슬롯부터 재처리
   - 영향받는 입금 건 상태를 PENDING으로 되돌림

실제로는 빈 슬롯(skipped slot) 처리에 더 유의해야 한다:
  slot 100 (블록 존재) → slot 101 (빈 슬롯) → slot 102 (블록 존재)
  slot 102의 previousBlockhash는 slot 100의 blockhash를 가리킴
```

#### RingBuffer 유지

```
최근 N개 블록의 (slot, blockhash) 쌍을 메모리에 유지:

RingBuffer<{ slot: number, blockhash: string }>(size: 32)

새 블록 처리 시:
  ring.push({ slot, blockhash })
  이전 블록의 blockhash와 대조
  → 불일치 시 ring에서 분기점 탐색

32개면 충분한 이유:
  - finalized 도달까지 ~32슬롯 (~13초)
  - finalized 후 reorg는 불가능
  - ring은 finalized 이후 오래된 항목을 자연스럽게 버림
```

### EVM과의 비교

| 항목 | EVM (PoS) | Solana (Tower BFT) |
|------|-----------|-------------------|
| Finality 방식 | 2 epoch (~13분) 후 경제적 확정 | 2/3 투표 + 지수적 lockout |
| Finality 시간 | ~13분 (확정적) | ~13초 (finalized) |
| Reorg 가능성 | 극히 낮음 (경제적 비용) | 사실상 0 |
| 관측된 finalized reorg | 없음 (PoS 이후) | 없음 (전체 역사) |
| Dagaon 대응 | Event Confirmer로 15 confirmation 대기 | finalized = 즉시 확정 |
| 방어적 구현 | RingBuffer + reorg detection | RingBuffer + previousBlockhash 검증 |

### 결론

Reorg 리스크는 Solana 통합에서 가장 낮은 리스크이다. EVM에서의 Event Confirmer 단계가 불필요해지므로, 오히려 파이프라인이 단순화되는 이점이 있다. 방어적 코드(previousBlockhash 검증, RingBuffer)는 비용이 거의 없으므로 유지하되, 이것이 실제로 트리거될 일은 사실상 없다.
