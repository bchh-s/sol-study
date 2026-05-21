# 2. EVM vs Solana 핵심 차이 요약

원문: ../solana-integration-research.md

## 이 폴더의 목표

두 체인의 차이를 암기용 비교표가 아니라 **구현 의사결정**으로 연결한다. 각 차이에 대해 "왜 다른가?"를 이해하고, Dagaon Core에서 "무엇을 어떻게 바꿔야 하는가?"까지 도출한다.

---

## 원문 핵심 발췌 - 확장 비교표

### 전체 비교표 (18개 차원)

| # | 구분 | EVM (현재) | Solana | 왜 다른가? | 구현 결정 |
|---|------|-----------|--------|-----------|----------|
| 1 | **블록 단위** | Block (12s/block) | Slot (400ms/slot), 빈 슬롯 존재 | EVM은 PoS에서 고정 간격으로 블록을 생성한다. Solana는 PoH 기반으로 리더 스케줄에 따라 슬롯을 배정하며, 리더가 오프라인이거나 포크가 폐기되면 빈 슬롯이 된다. | `getBlocks(start, end)`로 빈 슬롯을 자동 건너뛰는 스캐닝 구현 |
| 2 | **블록 번호** | block_number (연속 정수) | slot_number != block_height | EVM에서는 모든 블록 번호에 블록이 존재하므로 `n+1` 순차 조회가 가능하다. Solana에서는 빈 슬롯 때문에 slot_number가 불연속이고, block_height는 빈 슬롯을 건너뛰어 별도로 카운트된다. | DB에 `slot_number`와 `block_height` 모두 저장. 스캐닝은 slot 기준, 표시는 block_height 기준 |
| 3 | **블록 시간** | ~12초 (PoS 고정) | ~400ms (가변, 빈 슬롯 제외) | EVM PoS는 12초 간격으로 확정적 슬롯을 생성한다. Solana는 PoH 시계 기반으로 훨씬 빠르지만, 네트워크 상태에 따라 실제 블록 생성 속도가 변한다. | Publisher의 폴링 주기를 대폭 단축 (12s → 1-2s) 또는 WebSocket 구독 사용 |
| 4 | **Finality** | confirmation_blocks 카운트 (15~64블록, 3-13분) | Commitment level: processed/confirmed/finalized (~13s) | EVM은 확률적 finality로, 후속 블록이 쌓일수록 뒤집힐 확률이 기하급수적으로 감소한다. Solana는 투표 기반 finality로, supermajority(66%) 투표와 lockout 메커니즘으로 확정성을 보장한다. | `finalized` commitment만 사용하여 입금 확정. Event Confirmer 단계 제거 |
| 5 | **Reorg** | 발생함 → parentHash RingBuffer로 감지 | finalized에서 관측된 적 없음 | EVM에서는 동시에 여러 마이너가 블록을 생성할 수 있어 포크가 자연스럽게 발생한다. Solana에서는 리더 스케줄이 미리 정해져 있고, Tower BFT의 지수적 lockout이 깊은 reorg를 경제적으로 불가능하게 만든다. | RingBuffer를 `previousBlockhash` 기반으로 방어적 유지. 실제 트리거 가능성은 극히 낮음 |
| 6 | **Nonce** | 순차 정수 (sender별, gap 불허) | 없음 → recent blockhash(60-90s 만료) 또는 durable nonce(만료 없음) | EVM nonce는 TX 순서를 보장하고 replay를 방지한다. Solana는 blockhash로 TX의 유효 기간을 제한하여 replay를 방지하고, 순서는 별도로 보장하지 않는다 (병렬 실행 설계). | Durable nonce 풀 관리 시스템 구현. 풀 크기 = 동시 출금 한도 |
| 7 | **Mempool** | 있음 (pending tx가 체류, replacement 가능) | 없음 → 리더에게 직접 전달, 드롭 가능 | EVM의 mempool은 마이너가 TX를 선택하는 "대기열"이다. Solana의 Gulf Stream은 TX를 예상 리더에게 직접 forwarding하므로 별도 대기열이 불필요하다. 대신 리더가 수신 못 하면 TX가 유실된다. | tx-sender에 2초 간격 재전송 루프 구현. `signatureSubscribe`로 확인 대기 |
| 8 | **서명 알고리즘** | secp256k1 (ECDSA) | Ed25519 (EdDSA) | EVM은 비트코인에서 secp256k1을 계승했다. Solana는 속도와 보안성이 우수한 Ed25519를 선택했다. EdDSA는 결정적 서명(동일 입력 = 동일 출력)이라 사이드 채널 공격에 더 강하다. | KMS에 `ECC_NIST_EDWARDS25519` 키 추가. tx-signer에서 MessageType을 DIGEST에서 RAW로 변경 |
| 9 | **주소 형식** | 0x + 40자 hex (42자, EIP-55 checksum) | base58, 32-44자 (공개키 = 주소) | EVM 주소는 공개키의 keccak256 해시 하위 20바이트이므로 정보가 손실된다. Solana 주소는 공개키 자체이므로 주소에서 직접 서명을 검증할 수 있다. base58은 사람이 읽기 편하도록 혼동 문자(0/O/I/l)를 제외한다. | 모든 주소 검증/저장을 VARCHAR(44) + base58 validator로 변경. DB 테이블 분리 |
| 10 | **토큰 표준** | ERC20 (event log 기반 감지) | SPL Token (balance diff 기반 감지) | EVM 토큰은 각각 독립 컨트랙트이고, Transfer 이벤트를 발생시킨다. Solana 토큰은 단일 Token Program이 모든 토큰을 관리하고, TX 전후 잔액 스냅샷으로 전송을 추적한다. | Block Consumer의 transfer 추출 로직을 balance diff 방식으로 새로 구현 |
| 11 | **토큰 수신** | 아무 주소나 ERC20 수신 가능 | Associated Token Account(ATA) 사전 생성 필요 (~0.00204 SOL) | EVM은 컨트랙트 내부의 mapping으로 잔액을 관리하므로 수신자가 특별한 준비를 할 필요가 없다. Solana는 토큰별로 전용 계정(ATA)이 필요하며, 이 계정의 rent-exempt 비용을 누군가 부담해야 한다. | ATA 자동 생성 모듈 구현. deposit 지갑 생성 시 또는 첫 입금 시 lazy 생성. `createAssociatedTokenAccountIdempotent` 사용 |
| 12 | **Fee 모델** | Gas (baseFee + priorityFee, 글로벌 시장) | Base 5,000 lamports + priority fee (로컬 시장) | EVM은 전체 네트워크가 하나의 수수료 시장을 공유한다. Solana는 프로그램/계정별로 독립적인 로컬 수수료 시장을 운영하여, 무관한 프로그램의 혼잡이 우리 TX에 영향을 주지 않는다. | fee 추정을 `getRecentPrioritizationFees`로 변경. compute unit price/limit DTO 추가 |
| 13 | **Fee Delegation** | 복잡 (meta-tx, EIP-2771, Paymaster, Relay 서버 필요) | 네이티브 지원 (fee payer = 첫 번째 서명자, 추가 인프라 불필요) | EVM에서 fee delegation은 프로토콜 레벨에서 지원하지 않아 스마트 컨트랙트와 Relay 인프라가 필요하다. Solana는 TX 구조 자체에 fee payer 개념이 내장되어 있어, 첫 번째 서명자가 자동으로 수수료를 부담한다. | 기존 meta-tx 인프라 불필요. 핫월렛을 fee payer + authority로 설정하면 끝 |
| 14 | **실패 TX 처리** | 블록에 포함, gas 소비, receipt status=0 | 블록에 포함, base fee(5,000 lamports) 소비, meta.err != null | 두 체인 모두 실패 TX를 블록에 포함하고 수수료를 소비한다. 차이는 감지 방법이다. EVM은 receipt의 status 필드, Solana는 meta.err 필드를 확인한다. | Block Consumer에서 `meta.err` null 체크를 transfer 추출 전에 반드시 수행. 회계 로직에 실패 TX fee 추적 추가 |
| 15 | **TX 구조** | 단일 함수 호출 (1 TX = 1 action) | 다중 instruction 번들 (1 TX = N actions, atomic batch) | EVM TX는 하나의 컨트랙트 함수만 호출한다 (internal call은 가능하지만 사용자 시점에서는 단일). Solana TX는 여러 instruction을 원자적으로 묶을 수 있어 "ATA 생성 + 토큰 전송"을 하나의 TX로 처리한다. | TX 빌더에서 다중 instruction 조합 지원. AdvanceNonce + Transfer, 또는 CreateATA + Transfer 패턴 |
| 16 | **TX 크기** | Gas limit으로 제한 (이론적으로 큰 calldata 가능) | 1,232 bytes 하드 리밋 | EVM은 실행 비용(gas)으로 TX 복잡도를 제한한다. Solana는 TX 바이트 크기를 물리적으로 제한하여 네트워크 패킷(MTU) 내에 맞춘다. | Versioned Transaction(v0) + Address Lookup Tables로 계정 참조를 압축. TX 크기 초과 시 분할 전략 |
| 17 | **병렬 실행** | 순차 실행 (EVM은 TX를 하나씩 처리) | 병렬 실행 (Sealevel, 충돌 없는 TX끼리 동시 처리) | EVM은 global state를 공유하므로 순차 처리가 필수다. Solana는 TX가 접근하는 계정을 미리 선언(account list)하므로 겹치지 않는 TX를 동시에 실행할 수 있다. | 직접적 코드 변경은 불필요하나, TX에 사용할 계정 목록을 정확히 선언해야 함 (read-only vs writable 구분) |
| 18 | **직렬화** | RLP (Recursive Length Prefix) | Solana 자체 바이너리 포맷 (compact-u16 길이 접두사) | EVM은 범용 직렬화 포맷인 RLP을 채택했다. Solana는 성능 최적화를 위해 자체 바이너리 포맷을 설계했다. | tx-signer에서 RLP 인코딩을 Solana SDK의 `Transaction.serialize()`로 교체 |

---

### 각 차이에 대한 상세 분석

#### 1. 블록 단위: Block vs Slot

EVM의 블록은 12초마다 정확히 하나가 생성되며, 모든 블록 번호에 블록이 존재한다. Block Publisher는 `for n = lastProcessed+1; getBlockByNumber(n); n++` 같은 단순한 순차 조회로 구현된다.

Solana의 슬롯은 ~400ms마다 배정되지만, 모든 슬롯에 블록이 생성되지는 않는다. 리더가 오프라인이거나 포크가 폐기된 슬롯은 비어 있다. 따라서 `getBlocks(startSlot, endSlot, "finalized")`로 **존재하는 블록의 슬롯 목록**을 먼저 조회한 뒤, 각 슬롯에 `getBlock(slot)`을 호출해야 한다.

**코드 레벨 영향:**
```go
// EVM (현재)
for n := lastProcessed + 1; ; n++ {
    block, err := client.GetBlockByNumber(n)
    // ...
}

// Solana (변경)
slots, err := client.GetBlocks(lastProcessed+1, currentSlot, "finalized")
for _, slot := range slots {
    block, err := client.GetBlock(slot, opts)
    // ...
}
```

**변경 파일:** `block-publisher/plugins/solana/scanner.go` (신규)

#### 2. 블록 번호: 연속 vs 불연속

EVM에서 `block_number`는 곧 블록의 고유 식별자이자 순서 번호이다.

Solana에서는 두 가지 번호가 있다:
- `slot_number`: 네트워크 전체의 시간 단위. 빈 슬롯 포함, 불연속.
- `block_height`: 실제 생성된 블록만 카운트. 연속 정수.

Block Publisher가 checkpoint로 사용하는 "마지막 처리 번호"는 `slot_number`여야 한다 (빈 슬롯도 "처리됨"으로 건너뛰기 위해). 하지만 사용자에게 표시하거나 전체 블록 수를 계산할 때는 `block_height`가 적합하다.

**DB 영향:** `solana_blocks` 테이블에 `slot_number`(PK)와 `block_height`(인덱스) 모두 저장.

#### 3. 블록 시간: 12초 고정 vs 400ms 가변

EVM에서 12초 간격은 Block Publisher의 폴링 주기 설계에 직접 영향을 준다. 보통 2-5초마다 새 블록을 확인한다.

Solana에서 ~400ms 간격은 초당 2-3개의 블록이 생성된다는 의미다. 단순 HTTP 폴링으로는 부하가 크므로 두 가지 대안을 고려해야 한다:

1. **WebSocket `slotSubscribe`**: 새 슬롯 알림을 실시간으로 수신
2. **gRPC Geyser 플러그인**: 대량 블록 스트리밍에 최적화

Phase 2에서는 HTTP 폴링(1-2초 주기)으로 시작하고, 볼륨이 증가하면 gRPC로 전환한다.

#### 4. Finality: 확률적 vs 투표 기반

EVM의 confirmation 기반 finality는 "후속 블록이 N개 쌓이면 안전하다"는 확률적 판단이다. Ethereum에서 15블록(~3분), BSC에서 15블록(~45초)을 기다린다. Event Confirmer가 이 로직을 담당한다.

Solana의 commitment level 기반 finality는 validator 투표 결과에 따른 확정적 판단이다:
- `processed` (~400ms): 블록이 처리됨. 포크 가능성 ~5%.
- `confirmed` (~600ms): supermajority(66%) 투표 완료. 이론적 포크 가능하나 관측된 적 없음.
- `finalized` (~13s): 31+ 후속 블록의 lockout 완료. 경제적으로 뒤집기 불가능.

`finalized`를 사용하면 Event Confirmer 단계 자체가 불필요하다. 이는 파이프라인을 단순화하고 지연을 줄인다 (~13초 vs EVM의 3-13분).

**변경 파일:** `chain_config.solana.skip_event_confirmer = true` feature flag

#### 5. Reorg: 실질적 위험 vs 이론적 가능성

EVM 네트워크에서 reorg는 실제로 자주 발생한다. Ethereum에서 1-2블록 reorg는 일상적이고, 드물게 7블록 이상의 reorg도 관측된다. 따라서 RingBuffer 기반 reorg 감지는 필수적이다.

Solana `finalized` commitment에서 reorg는 관측된 적이 없다. Tower BFT의 지수적 lockout 메커니즘 때문에, finalized 블록을 뒤집으려면 전체 스테이크의 1/3 이상을 슬래싱 감수해야 한다. 경제적으로 비합리적이다.

그럼에도 방어적으로 `previousBlockhash` 기반 RingBuffer를 유지하는 이유:
1. "관측된 적 없음" != "불가능"
2. 구현 비용이 낮음 (기존 RingBuffer 로직 재사용)
3. 만약 발동되면 심각한 문제를 조기에 감지할 수 있음

#### 6. Nonce: 순차 정수 vs Durable Nonce 풀

**EVM 순차 nonce의 특성:**
```
nonce=0 → 채굴됨
nonce=1 → 채굴됨
nonce=2 → pending (mempool에서 대기)
nonce=3 → 전송 불가 (nonce=2가 채굴될 때까지)
```
- Gap이 발생하면 후속 TX가 모두 멈춤
- 같은 nonce로 새 TX를 보내면 replacement (gas bump)
- tx-ticketer가 `current_nonce++` atomic increment로 관리

**Solana durable nonce의 특성:**
```
nonce_account_1 (FREE) → TX #1에 할당 (IN_USE) → TX 확인 → 반환 (FREE)
nonce_account_2 (FREE) → TX #2에 할당 (IN_USE) → TX 확인 → 반환 (FREE)
nonce_account_3 (FREE) → TX #3에 할당 (IN_USE) → ...
```
- 순서 무관, 각 nonce 계정이 독립적
- 풀 크기 = 동시 출금 한도
- 취소: nonce advance만 실행 → 기존 TX 자동 무효화
- 만료 없음 (recent blockhash와 달리)

**코드 레벨 영향:**
```go
// EVM
nonce, err := db.IncrementNonce(walletID) // atomic increment

// Solana
nonceAccount, err := noncePool.Acquire(walletID) // FREE → IN_USE
defer noncePool.Release(nonceAccount)             // IN_USE → FREE
storedNonce, err := rpc.GetNonceValue(nonceAccount.Address)
```

#### 7. Mempool: 대기열 vs 직접 전달

**EVM mempool 기반 설계:**
TX를 한 번 전송하면 mempool에 들어가고, 마이너가 gas price 순으로 선택한다. TX가 mempool에 있는 한 "언젠가 채굴될 것"이라는 보장이 있다. stuck 상태는 gas가 너무 낮아 선택되지 않는 경우이며, gas bump로 해결한다.

**Solana 리더 직접 전달 설계:**
TX는 현재 슬롯의 리더와 다음 몇 슬롯의 예상 리더에게 Gulf Stream으로 forwarding된다. 리더가 수신하지 못하면 TX는 **흔적 없이 사라진다**. "보냈으니 안심"이 아니라 "확인될 때까지 계속 보내야" 한다.

**코드 레벨 영향:**
```go
// EVM tx-sender
err := client.SendRawTransaction(signedTx)
// 끝. mempool에 들어갔으므로 tx-monitor가 나중에 확인.

// Solana tx-sender
sig, err := client.SendTransaction(signedTx, SendOpts{MaxRetries: 0})
// 2초 간격 재전송 시작
go func() {
    ticker := time.NewTicker(2 * time.Second)
    for {
        select {
        case <-ticker.C:
            client.SendTransaction(signedTx, SendOpts{MaxRetries: 0}) // 동일 TX 재전송
        case <-confirmed:
            return
        case <-timeout:
            // priority fee bump → 새 TX 생성
            return
        }
    }
}()
```

#### 8. 서명 알고리즘: secp256k1 vs Ed25519

|  | secp256k1 (ECDSA) | Ed25519 (EdDSA) |
|--|-------------------|-----------------|
| 곡선 | Koblitz 곡선 | Edwards 곡선 |
| 서명 방식 | 랜덤 nonce 사용 (매번 다른 서명) | 결정적 (동일 입력 = 동일 서명) |
| 서명 속도 | 상대적으로 느림 | ~3배 빠름 |
| 검증 속도 | 배치 검증 불가 | 배치 검증 가능 (Solana가 빠른 이유 중 하나) |
| 사이드 채널 | 랜덤 nonce 생성기 품질에 의존 | 결정적이므로 RNG 의존성 없음 |
| 서명 크기 | 65 bytes (r, s, v) | 64 bytes |
| KMS 입력 | keccak256 해시 32 bytes (DIGEST) | 원본 메시지 bytes (RAW) |

**변경 파일:** `services/kms/solana_signer.go` (신규)

#### 9. 주소 형식: hex vs base58

```
EVM:    0x742d35Cc6634C0532925a3b844Bc9e7595f2BD1e  (42자 고정)
Solana: 7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2  (32-44자 가변)
```

**왜 길이가 가변인가?** base58은 고정 바이트(32)를 인코딩하지만, 앞쪽 0 바이트는 base58에서 "1"로 표현되고 생략되지 않는다. 대부분의 공개키는 44자이지만, 특수한 경우(System Program = `11111111111111111111111111111111` 등) 더 짧을 수 있다.

**코드 레벨 영향:**
- DB: `VARCHAR(42)` → `VARCHAR(44)`
- 검증: `/^0x[0-9a-fA-F]{40}$/` → base58 디코딩 후 32바이트 확인
- 표시: checksum 계산 불필요 (base58은 자체 오류 검출)
- 비교: case-sensitive (EVM hex는 case-insensitive)

#### 10. 토큰 표준: ERC20 event log vs SPL Token balance diff

**EVM ERC20 감지:**
```json
{
  "logs": [
    {
      "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "topics": [
        "0xddf252ad...",
        "0x000...sender",
        "0x000...receiver"
      ],
      "data": "0x00000000000000000000000000000000000000000000000000000000000f4240"
    }
  ]
}
```

**Solana SPL Token 감지:**
```json
{
  "preTokenBalances": [
    {"accountIndex": 1, "mint": "EPjFW...", "owner": "7Np41...", "uiTokenAmount": {"amount": "1000000", "decimals": 6}}
  ],
  "postTokenBalances": [
    {"accountIndex": 1, "mint": "EPjFW...", "owner": "7Np41...", "uiTokenAmount": {"amount": "0", "decimals": 6}}
  ]
}
```
diff: owner `7Np41...`의 mint `EPjFW...` 잔액이 1,000,000 → 0으로 감소 = 1 USDC 송금.

**변경 파일:** `block-consumer/plugins/solana/extractor.go` (신규)

#### 11. 토큰 수신: 무조건 수신 vs ATA 필요

EVM에서는 `transfer(to, amount)`만 호출하면 to 주소가 존재하지 않아도 토큰이 전송된다 (mapping에 잔액만 기록).

Solana에서는 수신자의 ATA(Associated Token Account)가 온체인에 존재해야 한다. ATA는 `(wallet, token_program, mint)` 조합으로 결정적으로 도출되며, 생성 비용은 ~0.00204 SOL이다.

**Dagaon Core 영향:**
1. **Deposit 지갑 생성 시:** 지원하는 각 토큰의 ATA를 사전 생성하거나, 첫 입금 감지 시 lazy 생성
2. **출금 시:** 수신자의 ATA 존재 여부 확인 → 없으면 TX에 `createAssociatedTokenAccountIdempotent` instruction 추가
3. **ATA 비용 관리:** fee payer(핫월렛)가 부담. 계정 close 시 ~0.00204 SOL 반환 가능

#### 12-13. Fee: 글로벌 시장 vs 로컬 시장, Fee Delegation

EVM의 수수료 예측은 네트워크 혼잡도에 크게 영향을 받는다. NFT 민팅 이벤트 하나가 전체 가스비를 10배 이상 끌어올릴 수 있다. tx-monitor의 gas bump 전략이 필수적이다.

Solana의 수수료는 기본 5,000 lamports/서명으로 저렴하고 예측 가능하다. Priority fee도 로컬 시장이므로 관련 없는 프로그램의 트래픽에 영향을 받지 않는다. 더 중요한 것은 fee delegation이 프로토콜 레벨에서 지원된다는 점이다. 첫 번째 서명자가 fee payer가 되므로, 핫월렛이 fee를 부담하고 유저 지갑은 SOL 없이 SPL 토큰만 보유해도 된다.

```
EVM fee delegation:  유저 서명 → Relay 서버 → Forwarder 컨트랙트 → 대상 컨트랙트 (30-50% 추가 gas)
Solana fee delegation: 핫월렛(fee payer) + 유저 지갑 → TX 실행 (0% 추가 비용)
```

#### 14. 실패 TX: status=0 vs meta.err

두 체인 모두 실패 TX가 블록에 포함되고 수수료가 소비된다. 차이점:

```go
// EVM
if receipt.Status == 0 { /* 실패 */ }

// Solana
if tx.Meta.Err != nil { /* 실패 */ }
```

**중요:** Solana에서 balance diff를 계산할 때, 실패 TX의 preBalances/postBalances는 fee 차감만 반영된다 (실제 전송은 롤백됨). 실패 TX를 필터링하지 않으면 "fee 차감분"을 전송으로 오인할 수 있다.

#### 15-16. TX 구조: 단일 호출 vs 다중 instruction, 크기 제한

Solana TX의 다중 instruction 특성은 "ATA 생성 + 토큰 전송"을 원자적으로 처리할 수 있게 한다. 하지만 1,232 byte 크기 제한 때문에, 많은 계정을 참조하는 TX는 Versioned Transaction(v0)과 Address Lookup Tables를 사용해야 한다.

**Dagaon Core에서 흔한 TX 패턴:**
```
패턴 1: SOL 전송 (단순)
  [AdvanceNonce] + [SystemProgram.Transfer]

패턴 2: SPL Token 전송 (ATA 존재)
  [AdvanceNonce] + [TokenProgram.Transfer]

패턴 3: SPL Token 전송 (ATA 없음)
  [AdvanceNonce] + [CreateAssociatedTokenAccount] + [TokenProgram.Transfer]

패턴 4: Sweep (수집)
  [AdvanceNonce] + [TokenProgram.Transfer] * N  ← 크기 제한 주의
```

#### 17-18. 병렬 실행과 직렬화

병렬 실행(Sealevel)은 Dagaon Core 구현에 직접적 변경을 요구하지 않지만, TX 구조에서 계정의 read-only/writable 구분을 정확히 해야 한다. 잘못된 구분은 TX 실패를 유발한다.

직렬화는 tx-signer 모듈의 핵심 변경 사항이다. RLP 인코딩 대신 Solana SDK의 직렬화를 사용하며, 서명 입력이 해시(DIGEST)에서 원본 바이트(RAW)로 변경된다.

---

## 개발할 내용

### 1. 체인별 주소 validator/normalizer 구현

**위치:** `common/address/`
**작업 범위:**
- `AddressValidator` 인터페이스 정의 (Validate, Normalize, Format)
- EVM 구현: hex 검증 + EIP-55 checksum
- Solana 구현: base58 디코딩 + 32바이트 길이 검증
- 기존 코드에서 hex 주소 검증이 하드코딩된 곳을 찾아 인터페이스로 교체

### 2. Nonce/Gas DTO 분리

**위치:** `withdrawal/dto/`
**현재:** `WithdrawalTx{Nonce int64, GasPrice *big.Int, GasLimit uint64, ...}`
**변경:** 공통 필드와 체인별 필드를 분리

```go
// 공통
type WithdrawalTxBase struct {
    RequestID int64
    From, To  string
    Amount    *big.Int
    Status    TxStatus
}

// EVM 전용
type EVMWithdrawalTx struct {
    WithdrawalTxBase
    Nonce    int64
    GasPrice *big.Int
    GasLimit uint64
    TxHash   string
}

// Solana 전용
type SolanaWithdrawalTx struct {
    WithdrawalTxBase
    NonceAccount     string
    NonceValue       string
    ComputeUnitPrice int64
    ComputeUnitLimit int32
    TxSignature      string
}
```

### 3. 실패 TX 처리 정책 통일

**위치:** `block-consumer/filter/`
**작업 범위:**
- `TxFilter` 인터페이스: `IsSuccess(tx RawTx) bool`
- EVM: `receipt.Status == 1`
- Solana: `meta.Err == nil`
- 실패 TX fee 추적 로직 (회계용)

### 4. Transfer 도메인 모델 통합

**위치:** `domain/transfer/`
**목표:** ERC20 event와 SPL Token balance diff를 같은 `Transfer` 도메인 모델로 매핑

```go
type Transfer struct {
    ChainID       int64
    BlockRef      string  // EVM: blockHash, Solana: slotNumber
    TxRef         string  // EVM: txHash, Solana: txSignature
    TransferType  TransferType  // Native, FungibleToken, NFT
    TokenRef      string  // EVM: contractAddress, Solana: mintAddress
    From          string
    To            string
    Amount        *big.Int
    Index         TransferIndex  // 체인별 고유 인덱스
}

type TransferIndex struct {
    // EVM
    LogIndex     int
    TraceAddress string
    // Solana
    InstructionIndex      int
    InnerInstructionIndex int
}
```

---

## 공부할 내용

### 1. Slot, Block Height, Commitment, Recent Blockhash, Durable Nonce의 관계

```
시간축 (Slot)
─────────────────────────────────────────────────►
 100  101  102  103  104  105  106  107  108  109
  |    x    |    |    x    |    |    |    |    |
  B1        B2   B3        B4   B5   B6   B7   B8
  h=1       h=2  h=3       h=4  h=5  h=6  h=7  h=8

  x = 빈 슬롯 (블록 없음)
  B = 생성된 블록
  h = block_height (빈 슬롯 제외하고 카운트)

Commitment 진행:
  slot 109 (B8) → processed (방금 처리됨)
  slot 108 (B7) → confirmed (66% 투표 완료)
  slot 105 (B4) → finalized (31+ lockout 완료)

Recent Blockhash:
  B8의 blockhash는 ~150 슬롯(약 60-90초) 후 만료
  이 blockhash를 사용한 TX는 만료 전에 확인되어야 함

Durable Nonce:
  nonce 계정의 storedNonce를 blockhash 대신 사용
  만료 없음 → KMS 서명에 시간 제약 없음
  AdvanceNonce 실행 시 storedNonce 갱신 → 이전 TX 무효화
```

### 2. SPL Token/ATA/Rent-exempt가 만드는 운영 비용

EVM에서 ERC20 토큰을 다루는 비용은 gas fee뿐이다. 주소가 있으면 토큰을 받을 수 있고, 추가 비용이 없다.

Solana에서 SPL Token을 다루려면:
1. **ATA 생성 비용:** 토큰/지갑 조합마다 ~0.00204 SOL (~$0.41 @$200/SOL)
2. **Nonce 계정 비용:** 핫월렛당 100개 = 0.15 SOL (~$30)
3. **Rent-exempt 유지:** 모든 계정이 최소 잔액을 유지해야 함

100개 deposit 지갑에서 5종 토큰을 지원한다면:
- ATA 생성: 100 * 5 * 0.00204 = 1.02 SOL (~$204)
- Nonce 계정: 100 * 0.0015 = 0.15 SOL (~$30)
- 합계: ~$234 (대부분 계정 close 시 반환 가능)

이 비용은 EVM에 없던 운영 비용이므로, 사업 모델에 반영해야 한다.

### 3. 로컬 Fee 시장과 Compute Unit Price/Limit 계산

```
priority_fee = ceil(compute_unit_price * compute_unit_limit / 1,000,000) lamports

예시 시나리오:
  시스템 혼잡도 낮음 → compute_unit_price = 100 micro-lamports
  SOL transfer → compute_unit_limit = 200,000 CU (기본값)
  priority_fee = ceil(100 * 200000 / 1000000) = 20 lamports ≈ $0.000004

  시스템 혼잡도 높음 → compute_unit_price = 50,000 micro-lamports
  priority_fee = ceil(50000 * 200000 / 1000000) = 10,000 lamports ≈ $0.002
```

`getRecentPrioritizationFees` RPC로 최근 슬롯의 priority fee 분포를 조회하고, p50-p75 범위를 기본값으로 사용한다. `simulateTransaction`으로 실제 compute unit 소비량을 측정하여 `computeUnitLimit`을 최적화할 수 있다 (불필요한 CU 예약을 줄이면 priority fee도 절감).

---

## 실습/검증 과제

### 과제 1: Solana devnet에서 JSON 응답 비교

- [ ] SOL transfer TX를 발생시키고 `getTransaction` 응답을 `fixtures/sol-transfer.json`으로 저장
- [ ] SPL Token transfer TX를 발생시키고 응답을 `fixtures/spl-transfer.json`으로 저장
- [ ] 두 응답에서 `preBalances/postBalances`, `preTokenBalances/postTokenBalances` 필드를 EVM receipt의 `logs` 필드와 비교 분석
- [ ] 실패 TX를 의도적으로 발생시키고 `meta.err` 구조를 `fixtures/failed-tx.json`으로 저장
- [ ] `getBlock` 응답의 `previousBlockhash` 필드를 확인하여 RingBuffer 적용 가능성 검증

### 과제 2: 비교표 코드 영향 분석

- [ ] 비교표 18개 행 각각에 대해 "변경이 필요한 파일/모듈" 컬럼을 추가
- [ ] 영향도가 "높음"인 항목(#5 ERC20, #6 nonce, #7 mempool, #8 RLP)에 대해 기존 코드의 해당 로직을 찾아 라인 수 추정
- [ ] 각 항목별 구현 복잡도를 S/M/L/XL로 평가

### 과제 3: Acceptance Criteria

- [ ] 18개 차이 모두에 대해 "왜 다른가?", "무엇을 바꿔야 하는가?"가 작성되어 있다
- [ ] 최소 4개 항목에 대해 devnet 실제 응답으로 차이를 검증하여 fixture가 존재한다
- [ ] Transfer 도메인 모델 통합 설계의 초안 코드가 작성되어 있다

---

## 완료 기준

- 18개 차원의 비교표가 완성되어 있고, 각 행에 "왜 다른가?" 설명과 "구현 결정"이 포함되어 있다.
- 영향도가 높은 항목(nonce, mempool, 서명, 토큰 감지, 직렬화)에 대해 코드 레벨 변경 예시가 작성되어 있다.
- EVM과 Solana의 TX 라이프사이클 차이를 시퀀스 다이어그램으로 설명할 수 있다.
- 최소 4개 항목에 대해 devnet 실제 응답 fixture가 `fixtures/` 디렉토리에 저장되어 있다.
- Transfer, WithdrawalTx 등 핵심 도메인 모델의 체인 추상화 설계 초안이 작성되어 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
- EVM to SVM Complete Guide: https://solana.com/developers/evm-to-svm/complete-guide
