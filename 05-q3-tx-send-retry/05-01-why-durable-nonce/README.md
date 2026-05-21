# 5.1 왜 Durable Nonce인가?

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)

## Recent Blockhash 메커니즘

Solana의 모든 트랜잭션은 `recentBlockhash` 필드를 포함해야 한다. 이 값은 트랜잭션의 유효 기간과 중복 방지(replay protection) 역할을 동시에 수행한다.

### getLatestBlockhash() 응답 구조

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 326542789 },
    "value": {
      "blockhash": "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
      "lastValidBlockHeight": 326542939
    }
  }
}
```

- `blockhash`: 최근 블록의 해시값. 트랜잭션의 `recentBlockhash` 필드에 넣는다.
- `lastValidBlockHeight`: 이 blockhash가 유효한 마지막 블록 높이. 이 높이를 넘으면 TX는 만료된다.

### 150개 해시 저장 = 60-90초 윈도우

Solana 런타임은 최근 **150개의 blockhash**를 저장한다. 슬롯 하나당 약 400ms이므로:

```
150 슬롯 x 400ms = 60초 (이론치)

그러나 실제로는:
- 슬롯 스킵(리더 미응답)으로 인해 실제 시간은 더 길어질 수 있음
- 네트워크 혼잡 시에는 더 짧아질 수 있음
- 실측 범위: 약 60~90초
```

중요한 것은 이 시간이 **TX 제출 시점**이 아니라 **blockhash 생성 시점**부터 카운트된다는 점이다:

```
시간축 ─────────────────────────────────────────────────────>

t=0s          t=30s              t=60s         t=90s
│              │                  │              │
▼              ▼                  ▼              ▼
blockhash     TX 빌드 시작       TX 제출         blockhash 만료
생성           (여기서부터                        (이미 60초 지남)
               시간이 흐름)
```

### 이 시간이 부족한 이유: KMS 서명 파이프라인

Dagaon Core의 출금 파이프라인에서 blockhash를 가져온 후 TX가 네트워크에 도달하기까지 거치는 단계:

```
┌──────────────────────────────────────────────────────────┐
│  blockhash 조회 (t=0)                                     │
│      │                                                    │
│      v                                                    │
│  TX 빌드 + instruction 구성 (~0.1초)                       │
│      │                                                    │
│      v                                                    │
│  큐 대기 (가변: 0초 ~ 수분)  ← 동시 출금 요청 많을 때      │
│      │                                                    │
│      v                                                    │
│  정책 승인 대기 (가변: 0초 ~ 수분)  ← 금액/주소 심사        │
│      │                                                    │
│      v                                                    │
│  KMS 서명 요청 → 응답 (1~2초)  ← AWS KMS 네트워크 왕복     │
│      │                                                    │
│      v                                                    │
│  서명 검증 + DB 저장 (~0.1초)                              │
│      │                                                    │
│      v                                                    │
│  TX 브로드캐스트 (t=???)  ← blockhash가 아직 유효한가?      │
│      │                                                    │
│      v                                                    │
│  확인 대기 (네트워크 상황에 따라 수초 ~ 수십초)              │
└──────────────────────────────────────────────────────────┘

최선: 1~3초 (큐 없음, 즉시 승인)
일반: 5~30초 (약간의 큐 대기)
최악: 수분 (정책 승인 지연, KMS 타임아웃 재시도)
```

**최악의 시나리오에서 blockhash가 만료**된다. 만료되면:
- 서명이 유효하더라도 TX는 네트워크에서 거부된다
- 처음부터 다시: blockhash 조회 -> TX 빌드 -> KMS 서명 -> 전송
- KMS 서명 비용이 이중으로 발생한다

### 레이스 컨디션: 만료 직전 제출의 위험

가장 위험한 시나리오는 **blockhash 만료 직전에 TX를 제출**하는 경우이다:

```
시간축 ────────────────────────────────────>
                                      만료 경계
                                         │
t=58s           t=59s        t=60s       │  t=61s
  │               │            │         │    │
  ▼               ▼            ▼         │    ▼
TX 제출 ──> RPC 수신 ──> 리더 전달 ──>  │  블록 포함?
                                         │
                                         │
                              상황 A: 만료 전 포함 -> 성공
                              상황 B: 만료 후 도달 -> 거부
```

문제는 **TX가 성공했는지 실패했는지 알기 어렵다**는 것이다:

- `getSignatureStatuses`가 `null`을 반환하면, TX가 아직 처리 중인지 아니면 만료되었는지 구분할 수 없다
- 만료되었다고 판단하고 새 TX를 만들면, 원래 TX가 뒤늦게 확인될 수 있다 -> **중복 출금**
- 만료를 기다리면, 이미 성공했을 TX를 불필요하게 재전송할 수 있다

```
[중복 출금 위험 시나리오]

1. TX_A를 blockhash_1로 전송 (t=58초)
2. 확인되지 않음. blockhash_1 만료 판단.
3. TX_B를 blockhash_2로 새로 서명하여 전송
4. TX_A가 사실은 블록에 포함되어 있었음!
5. TX_B도 블록에 포함됨
6. 결과: 동일 출금이 2번 실행됨 ← 치명적
```

## Durable Nonce: 만료 없는 blockhash

Durable Nonce는 위의 모든 문제를 해결하는 메커니즘이다.

### 핵심 원리

```
일반 TX:
  recentBlockhash = getLatestBlockhash()  ← 60-90초 후 만료

Durable Nonce TX:
  recentBlockhash = nonceAccount.storedNonce  ← 영원히 유효
  instruction[0] = AdvanceNonceAccount         ← 반드시 첫 번째 instruction
```

Nonce 계정에 저장된 `storedNonce` 값은 온체인 상태이다. 이 값은 `AdvanceNonceAccount` instruction이 실행될 때만 변경된다. TX가 아직 확인되지 않았다면, storedNonce는 그대로이고, TX는 계속 유효하다.

### Durable Nonce가 주는 이점

| 이점 | 상세 설명 |
|------|----------|
| 만료 없음 | storedNonce가 변경되지 않는 한 TX는 영원히 유효 |
| 무기한 재전송 | 같은 서명을 원하는 만큼 반복 전송 가능 |
| 결정적 취소 | nonce만 advance하면 기존 TX 즉시 무효화 |
| 중복 방지 | AdvanceNonce가 TX의 첫 instruction이므로, 같은 nonce로 두 TX가 동시에 성공할 수 없음 |
| KMS 호환 | 서명 후 아무리 오래 기다려도 TX가 만료되지 않음 |

### Durable Nonce TX의 라이프사이클

```
1. Nonce 계정에서 storedNonce 조회
   nonceAccount.storedNonce = "abc123..."

2. TX 빌드 (AdvanceNonceAccount 첫 번째 instruction)
   recentBlockhash = "abc123..."

3. KMS 서명 (시간 제약 없음)
   signedTx = sign(tx, privateKey)

4. TX 브로드캐스트
   sendTransaction(signedTx)

5-A. TX 확인됨:
   - AdvanceNonce 실행 → storedNonce가 "xyz789..."로 변경
   - Transfer 실행 → 출금 완료
   - 같은 nonce로 다른 TX를 보내도 거부됨 (nonce 불일치)

5-B. TX 드롭됨:
   - storedNonce는 여전히 "abc123..." (변경되지 않음)
   - 같은 signedTx를 다시 보내면 됨 → 재서명 불필요

5-C. TX 취소 필요:
   - AdvanceNonceAccount만 포함한 별도 TX 전송
   - storedNonce가 "xyz789..."로 변경
   - 기존 signedTx의 nonce("abc123...")가 더 이상 유효하지 않음 → 자동 무효화
```

### 레이스 컨디션 해소

Durable Nonce를 사용하면 중복 출금 위험이 사라진다:

```
[중복 출금이 불가능한 이유]

1. TX_A를 storedNonce="abc123"으로 전송
2. 확인되지 않음 → storedNonce를 확인 → 여전히 "abc123"
3. TX_A는 아직 유효함 → 같은 TX_A를 다시 전송 (재서명 필요 없음)
4. TX_A가 블록에 포함됨 → storedNonce가 "xyz789"로 변경
5. 같은 TX_A를 또 보내도 nonce 불일치로 거부됨

→ 어떤 시나리오에서든 TX_A는 정확히 1번만 실행된다
```

## 참고 자료

- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
