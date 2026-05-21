# 5.3 출금 파이프라인 비교 (EVM vs Solana)

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)

## 파이프라인 개요

Dagaon Core의 출금 파이프라인은 4개 컴포넌트로 구성된다. Solana 통합 시 각 컴포넌트의 역할은 유지하되, 내부 로직이 크게 변경된다.

```
EVM (현재):
  tx-ticketer  →  tx-signer  →  tx-sender  →  tx-monitor

Solana (변경):
  tx-preparer  →  tx-signer  →  tx-sender  →  tx-monitor
  (tx-ticketer 대체)
```

## 단계별 상세 비교

### Stage 1: tx-ticketer (EVM) vs tx-preparer (Solana)

**역할**: 출금 요청을 받아 unsigned TX를 생성한다.

#### EVM (현재)

```
tx-ticketer:
  1. 출금 요청 획득 (SELECT ... FOR UPDATE SKIP LOCKED)
  2. Phase 1: 요청 상태를 PROCESSING으로 변경, TX row 생성
  3. Phase 2: nonce 할당 (current_nonce++ atomic), gas 조회
     - nonce = 순차 정수 (0, 1, 2, ...)
     - gasPrice = eth_gasPrice() 또는 EIP-1559 fee 조회
  4. unsigned TX 생성
     - to, value, data, nonce, gasLimit, gasPrice, chainId
  5. DB 저장 (status = PENDING)
```

#### Solana (변경)

```
tx-preparer:
  1. 출금 요청 획득 (동일)
  2. Phase 1: 요청 상태를 PROCESSING으로 변경, TX row 생성
  3. Phase 2: nonce 계정 할당 + compute unit 조회
     - nonce 풀에서 FREE 계정 할당 (SELECT ... FOR UPDATE SKIP LOCKED)
     - 할당된 계정의 status = IN_USE, withdrawal_id = current
     - storedNonce 조회: getNonce RPC 또는 getAccountInfo + 디코딩
     - compute unit limit/price 조회: getRecentPrioritizationFees
  4. unsigned TX 빌드
     - instruction[0]: AdvanceNonceAccount(nonceAccount, authority)
     - instruction[1]: Transfer / SPL Transfer
     - instruction[2]: SetComputeUnitLimit (선택)
     - instruction[3]: SetComputeUnitPrice (선택)
     - recentBlockhash = storedNonce
     - feePayer = hotWallet
  5. DB 저장 (status = PENDING)
     - nonce_account_id, stored_nonce 값도 함께 저장
```

**핵심 차이**:

| 항목 | EVM | Solana |
|------|-----|--------|
| Nonce 소스 | DB의 순차 카운터 (atomic increment) | 온체인 nonce 계정 풀에서 할당 |
| Nonce 형태 | uint64 정수 | 32-byte base58 해시 |
| Gas/Fee 조회 | eth_gasPrice (1 RPC) | getRecentPrioritizationFees (1 RPC) |
| TX 구조 | RLP 인코딩 대상 필드들 | instruction 배열 + message |
| 추가 instruction | 없음 | AdvanceNonceAccount (필수, 첫 번째) |

---

### Stage 2: tx-signer

**역할**: unsigned TX를 KMS로 서명한다.

#### EVM (현재)

```
tx-signer:
  1. unsigned TX를 RLP 인코딩
  2. keccak256 해싱 → 32바이트 다이제스트
  3. KMS Sign (ECDSA_SHA_256, MessageType=DIGEST)
  4. DER 서명 파싱 → r, s 추출
  5. s 정규화 (EIP-2: low-s enforcement)
  6. v (recovery id) 계산
  7. signed TX = RLP(tx + v, r, s)
  8. tx_hash = keccak256(signed TX)
  9. DB 저장 (signed_tx, tx_hash, status=SIGNED)
     ← 반드시 브로드캐스트 전에 저장
```

#### Solana (변경)

```
tx-signer:
  1. Transaction message serialize → 가변 길이 바이트
  2. (해싱 없음 - Ed25519가 내부적으로 SHA-512 수행)
  3. KMS Sign (EDDSA_ED25519_SHA_512, MessageType=RAW)
  4. 64바이트 raw 서명 (R 32B + S 32B) - 파싱 불필요
  5. (s 정규화 불필요)
  6. (v 계산 불필요)
  7. signed TX = [signatures] + [message]
  8. tx_signature = base58(signatures[0]) ← 서명 자체가 TX ID
  9. DB 저장 (signed_tx, tx_signature, status=SIGNED)
     ← 반드시 브로드캐스트 전에 저장
```

**핵심 차이**:

| 항목 | EVM | Solana |
|------|-----|--------|
| KMS 입력 | 32B 해시 (keccak256) | 원본 메시지 바이트 (RAW) |
| KMS 알고리즘 | ECDSA_SHA_256 | EDDSA_ED25519_SHA_512 |
| 서명 크기 | 가변 (DER: 70-72B) | 고정 (64B) |
| 후처리 | DER 파싱 + s 정규화 + v 계산 | 없음 |
| TX ID 도출 | keccak256(signed TX) | base58(signature) |

---

### Stage 3: tx-sender

**역할**: 서명된 TX를 네트워크에 전송한다. Solana에서 **가장 크게 변경**되는 컴포넌트.

#### EVM (현재)

```
tx-sender:
  1. eth_sendRawTransaction(signedTx)
  2. 응답 처리:
     - 성공 → status = BROADCASTED
     - "already known" → BROADCASTED (중복, 정상)
     - "nonce too low" → BROADCASTED (이미 처리됨)
     - "replacement underpriced" → gas bump 필요
     - timeout → retry_at 설정
  3. 완료. mempool이 TX를 보관하므로 재전송 불필요.
```

#### Solana (변경)

```
tx-sender:
  1. sendTransaction(signedTx, {
       skipPreflight: false,
       maxRetries: 0,       ← RPC의 자체 재전송 비활성화 (우리가 직접 제어)
       preflightCommitment: "confirmed"
     })
  2. signatureSubscribe(txSignature) 등록 (WebSocket)
  3. 재전송 루프 시작:
     while (!confirmed && retryCount < MAX_RETRIES) {
       sleep(2초)
       sendTransaction(signedTx, { skipPreflight: true, maxRetries: 0 })
       status = getSignatureStatuses([txSignature])
       if (status.confirmationStatus == "confirmed") {
         confirmed = true
         break
       }
       retryCount++
     }
  4. 결과 처리:
     - confirmed → status = COMPLETED
     - MAX_RETRIES 초과 → 판단 로직:
       a. storedNonce 확인 → 변경됨 → TX가 온체인에서 처리됨 → COMPLETED
       b. storedNonce 확인 → 동일 → TX가 드롭됨 → nonce advance → 새 TX 생성
     - 에러 (Simulation failed 등) → nonce advance → 새 TX 생성
```

**핵심 차이**:

| 항목 | EVM | Solana |
|------|-----|--------|
| 전송 횟수 | 1회 (mempool에 들어감) | 다수 (2초마다 재전송) |
| 재전송 주체 | 노드의 mempool | 우리 코드 (tx-sender) |
| 응답 의미 | TX가 mempool에 들어감 | TX가 리더에게 전달됨 (보장 없음) |
| 실패 감지 | RPC 에러 응답 | 상태 조회 결과 없음 + nonce 변화 없음 |
| WebSocket | 불필요 (eth_getTransactionReceipt 폴링) | signatureSubscribe 활용 |
| maxRetries | 해당 없음 | 0으로 설정 (직접 제어) |

---

### Stage 4: tx-monitor

**역할**: 전송된 TX의 최종 상태를 확인하고, stuck TX를 처리한다.

#### EVM (현재)

```
tx-monitor:
  1. stuck TX 폴링 (SELECT * WHERE retry_at <= NOW())
  2. eth_getTransactionReceipt(txHash)로 확인 상태 조회
  3. 결과:
     - receipt 있음 + status=1 → COMPLETED
     - receipt 있음 + status=0 → FAILED (실행 실패, gas 소비됨)
     - receipt 없음 + gas 부족 판단 → gas bump
       - 같은 nonce + 10% 높은 gasPrice로 새 TX 생성
       - 원본 TX status = REPLACED
       - 새 TX status = PENDING → tx-signer로 전달
  4. 주기: 10초 간격 폴링
```

#### Solana (변경)

```
tx-monitor:
  1. stuck TX 폴링 (SELECT * WHERE status = BROADCASTED AND updated_at < NOW() - interval)
  2. getSignatureStatuses([txSignature])로 확인 상태 조회
  3. 결과:
     - confirmationStatus = "finalized" → COMPLETED
     - confirmationStatus = "confirmed" → CONFIRMED (finalized 대기)
     - confirmationStatus = null (미확인):
       a. nonce 계정의 storedNonce 조회
       b. storedNonce 변경됨 → TX가 처리됨 (확인 대기)
       c. storedNonce 동일 → TX 드롭됨 판단
          - 재전송 카운터 < 한도 → 재전송
          - 재전송 카운터 >= 한도 → priority fee bump:
            1. AdvanceNonce만 전송하여 기존 TX 무효화
            2. 새 nonce 값으로 새 TX 빌드
            3. 더 높은 priority fee 설정
            4. tx-signer → tx-sender 파이프라인으로 전달
  4. signatureSubscribe WebSocket도 병행 (이벤트 기반 확인)
  5. 주기: 5초 간격 폴링 + WebSocket 이벤트
```

**핵심 차이**:

| 항목 | EVM | Solana |
|------|-----|--------|
| 확인 조회 | eth_getTransactionReceipt | getSignatureStatuses |
| 최종 확인 | 1 confirmation (또는 N개) | "finalized" (31+ confirmations) |
| Gas bump 방법 | 같은 nonce + 더 높은 gas | nonce advance 후 새 TX |
| 이벤트 감시 | 없음 (폴링만) | signatureSubscribe (WebSocket) |
| Stuck 판단 | receipt 없음 + 시간 경과 | signatureStatus null + storedNonce 동일 |
| 실패 TX 비용 | gas 전액 소비 | base fee만 소비 |

## 상태 전이 다이어그램

### EVM 상태 전이

```
PENDING ──(서명)──> SIGNED ──(전송)──> BROADCASTED ──(receipt)──> COMPLETED
                                           │
                                      (stuck + gas 부족)
                                           │
                                           v
                                       REPLACED ──> (새 TX: PENDING → ...)
```

### Solana 상태 전이

```
PENDING ──(서명)──> SIGNED ──(전송)──> BROADCASTED
                                           │
                              ┌─────────────┼─────────────┐
                              │             │             │
                              v             v             v
                         CONFIRMED    DROPPED        FAILED
                              │             │             │
                              v             │             │
                        FINALIZED      (재전송 or       (nonce advance
                         (완료)        priority bump)   + 새 TX)
                                           │             │
                                           v             v
                                     RETRIED ──> PENDING (새 TX)
```

## 시퀀스 다이어그램

### EVM 출금 시퀀스

```
Client        tx-ticketer      tx-signer       tx-sender      tx-monitor     EVM Node
  │               │                │               │               │            │
  │  출금 요청     │                │               │               │            │
  ├──────────────>│                │               │               │            │
  │               │                │               │               │            │
  │               │ nonce++ (DB)   │               │               │            │
  │               │ unsigned TX    │               │               │            │
  │               ├───────────────>│               │               │            │
  │               │                │               │               │            │
  │               │                │ RLP + keccak  │               │            │
  │               │                │ KMS Sign      │               │            │
  │               │                │ DER parse     │               │            │
  │               │                │ signed TX     │               │            │
  │               │                ├──────────────>│               │            │
  │               │                │               │               │            │
  │               │                │               │ sendRawTx     │            │
  │               │                │               ├──────────────────────────>│
  │               │                │               │               │   txHash  │
  │               │                │               │<─────────────────────────┤
  │               │                │               │               │            │
  │               │                │               │  BROADCASTED  │            │
  │               │                │               │               │            │
  │               │                │               │         (폴링) │            │
  │               │                │               │<──────────────┤            │
  │               │                │               │               │ getReceipt │
  │               │                │               │               ├───────────>│
  │               │                │               │               │   receipt  │
  │               │                │               │               │<──────────┤
  │               │                │               │               │            │
  │               │                │               │  COMPLETED    │            │
  │<──────────────────────────────────────────────────────────────┤            │
  │   출금 완료    │                │               │               │            │
```

### Solana 출금 시퀀스

```
Client     tx-preparer    tx-signer     tx-sender         tx-monitor     Solana RPC
  │            │              │              │                 │              │
  │ 출금 요청   │              │              │                 │              │
  ├───────────>│              │              │                 │              │
  │            │              │              │                 │              │
  │            │ nonce 할당    │              │                 │              │
  │            │ (풀에서 FREE  │              │                 │              │
  │            │  계정 선택)    │              │                 │              │
  │            │              │              │                 │              │
  │            │ storedNonce   │              │                 │              │
  │            │ 조회 (RPC)    │              │                 │              │
  │            │<─────────────────────────────────────────────────────────────┤
  │            │              │              │                 │              │
  │            │ unsigned TX   │              │                 │              │
  │            │ (AdvanceNonce │              │                 │              │
  │            │  + Transfer)  │              │                 │              │
  │            ├──────────────>│              │                 │              │
  │            │              │              │                 │              │
  │            │              │ serialize    │                 │              │
  │            │              │ KMS Sign     │                 │              │
  │            │              │ (RAW, Ed25519)                 │              │
  │            │              │ 64B 서명      │                 │              │
  │            │              ├─────────────>│                 │              │
  │            │              │              │                 │              │
  │            │              │              │ sendTransaction │              │
  │            │              │              │ (maxRetries=0)  │              │
  │            │              │              ├─────────────────────────────-->│
  │            │              │              │                 │    signature │
  │            │              │              │<────────────────────────────--┤
  │            │              │              │                 │              │
  │            │              │              │ signatureSubscribe             │
  │            │              │              ├─────────────────────────────-->│
  │            │              │              │                 │              │
  │            │              │              │ [2초 대기]       │              │
  │            │              │              │ sendTransaction │              │
  │            │              │              │ (재전송, skipPreflight=true)    │
  │            │              │              ├─────────────────────────────-->│
  │            │              │              │                 │              │
  │            │              │              │ ...반복...       │              │
  │            │              │              │                 │              │
  │            │              │              │ WebSocket 알림:  │              │
  │            │              │              │ "confirmed"     │              │
  │            │              │              │<────────────────────────────--┤
  │            │              │              │                 │              │
  │            │              │              │ CONFIRMED       │              │
  │            │              │              │                 │              │
  │            │              │              │           (폴링) │              │
  │            │              │              │<────────────────┤              │
  │            │              │              │                 │ getSigStatus │
  │            │              │              │                 ├─────────────>│
  │            │              │              │                 │  "finalized" │
  │            │              │              │                 │<────────────┤
  │            │              │              │                 │              │
  │            │              │              │ FINALIZED       │              │
  │            │  nonce 반환   │              │                 │              │
  │            │  (FREE)       │              │                 │              │
  │<───────────────────────────────────────────────────────────┤              │
  │  출금 완료  │              │              │                 │              │
```

## 참고 자료

- Solana Transaction Processing: https://solana.com/docs/core/transactions
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
