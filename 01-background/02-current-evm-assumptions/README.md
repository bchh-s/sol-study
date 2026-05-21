# 현재 EVM 전제 조건들

상위 섹션: [1. 배경](../README.md)
원문: ../../solana-integration-research.md

---

## 원문 핵심 발췌

Dagaon Core의 모든 컴포넌트는 EVM 체인의 특성을 암묵적 전제로 설계되었다. Solana 통합 시 이 전제들이 어디서 깨지는지 정확히 파악해야 한다.

### EVM 전제 조건 전체 목록

| # | EVM 전제 | 왜 존재하는가 | Solana에서의 현실 | 마이그레이션 영향도 |
|---|---------|-------------|------------------|-------------------|
| 1 | **모든 블록에 parentHash 존재** | 블록 간 연결고리로 reorg를 감지한다. RingBuffer에 최근 N개 블록의 hash를 저장하고, 새 블록의 parentHash와 비교하여 체인 연속성을 검증한다. | Solana 블록에도 `previousBlockhash`와 `parentSlot` 필드가 존재한다. 그러나 `finalized` commitment에서 reorg가 관측된 적이 없으므로, 실질적으로 이 검증이 트리거될 일은 없다. | **낮음.** RingBuffer 로직 자체는 재사용 가능. `blockHash` -> `blockhash`, `parentHash` -> `previousBlockhash`로 필드명만 매핑하면 된다. 방어적으로 유지하되, 실제 동작할 가능성은 극히 낮다. |
| 2 | **sender별 순차 정수 nonce** | 동일 sender의 TX가 순서대로 처리되도록 보장한다. 같은 nonce로 더 높은 gas의 TX를 보내면 기존 TX를 대체(replacement)할 수 있다. tx-ticketer가 `current_nonce++` atomic increment로 gap 없이 관리한다. | Solana에는 순차 nonce 개념이 없다. 대신 `recent blockhash`(60-90초 만료)나 `durable nonce`(만료 없음)를 TX의 유효성 검증에 사용한다. TX 대체(replacement) 메커니즘도 없다. | **높음.** tx-ticketer의 nonce 할당 로직 전체를 durable nonce 풀 관리로 교체해야 한다. `wallets.current_nonce` 컬럼 대신 `solana_durable_nonce_accounts` 테이블이 필요하다. 동시 출금 한도가 nonce 풀 크기에 의존한다. |
| 3 | **EIP-1559 가스 모델** | `maxFeePerGas`와 `maxPriorityFeePerGas`로 수수료를 설정한다. `baseFee`는 블록 혼잡도에 따라 프로토콜이 결정하고, `priorityFee`는 사용자가 마이너에게 주는 팁이다. 글로벌 수수료 시장이므로 NFT 민팅 열풍이 일반 전송 수수료까지 올린다. | Solana는 **로컬 수수료 시장**을 사용한다. 기본 수수료는 서명당 5,000 lamports 고정이고, priority fee는 `compute_unit_price * compute_unit_limit / 1,000,000`으로 계산된다. 관련 없는 프로그램의 트래픽이 우리 TX 수수료에 영향을 주지 않는다. | **중간.** Fee 추정 로직을 `eth_gasPrice`/`eth_maxPriorityFeePerGas` 대신 `getRecentPrioritizationFees`로 교체. DTO에서 `gas_price`, `gas_limit`, `max_fee_per_gas` 필드를 `compute_unit_price`, `compute_unit_limit`으로 변경. |
| 4 | **42자 hex 주소 (0x prefix)** | secp256k1 공개키의 keccak256 해시 하위 20바이트를 hex 인코딩한다. EIP-55 mixed-case checksum으로 오류 검출한다. DB VARCHAR(42), 정규표현식 검증 `/^0x[0-9a-fA-F]{40}$/` 등이 하드코딩되어 있다. | Solana 주소는 Ed25519 공개키를 base58로 인코딩한 32-44자 문자열이다. 해싱이 필요 없고 공개키 = 주소다. base58은 `0`, `O`, `I`, `l`을 제외하여 사람이 읽기 편하다. | **중간.** 모든 주소 검증/정규화 로직 변경 필요. `VARCHAR(42)` -> `VARCHAR(44)`, hex 검증 -> base58 검증. DB 테이블을 분리하면 기존 EVM 테이블 수정은 불필요. `address_validator` 인터페이스를 도입하여 체인별 검증을 추상화해야 한다. |
| 5 | **ERC20 Transfer event log 파싱** | `Transfer(address indexed from, address indexed to, uint256 value)` 이벤트의 `topic[0] = keccak256("Transfer(address,address,uint256)")`을 매칭하여 토큰 전송을 감지한다. `log_index`로 하나의 TX 내 여러 전송을 구분한다. | Solana SPL Token은 event log 대신 **balance diff** 방식을 사용한다. TX 전후의 `preTokenBalances`와 `postTokenBalances`를 비교하여 전송 내역을 추출한다. mint address, owner, amount 정보가 포함된다. | **높음.** Block Consumer의 transfer 추출 로직을 완전히 재구현해야 한다. event log 파싱 대신 balance diff 계산 로직이 필요하다. Transfer 고유 식별자도 `(tx_hash, log_index)` 에서 `(tx_signature, instruction_index, inner_instruction_index)`로 변경된다. |
| 6 | **고정 21,000 gas (native transfer)** | ETH/KAIA/BNB native 전송은 항상 21,000 gas를 소비한다. 이 고정값으로 수수료를 사전에 정확히 예측할 수 있다. | Solana native SOL 전송의 기본 수수료는 5,000 lamports (서명 1개 기준)이다. 하지만 durable nonce TX는 `AdvanceNonceAccount` instruction이 추가되므로 compute unit이 더 소비된다. 또한 priority fee는 가변적이다. | **낮음.** 수수료 예측 로직을 `21000 * gasPrice`에서 `5000 + priorityFee`로 변경. `simulateTransaction`으로 실제 compute unit 소비량을 사전 확인할 수 있다. |
| 7 | **mempool에 TX 대기** | EVM TX는 mempool에 들어가면 언젠가 채굴되거나 replacement될 때까지 유지된다. 한 번 보내면 "잊어도 됨" 수준의 안정성이 있다. tx-monitor가 stuck TX를 gas bump로 해결한다. | Solana에는 mempool이 없다. TX는 현재 slot의 리더 validator에게 직접 전달되며, 리더가 수신하지 못하면 그냥 **드롭**된다. 아무런 흔적도 남지 않는다. | **높음.** tx-sender에 2초 간격 적극적 재전송 루프를 구현해야 한다. `sendTransaction`의 `maxRetries: 0`으로 설정하고 애플리케이션 레벨에서 재전송을 관리한다. `signatureSubscribe` WebSocket으로 확인을 감시한다. |
| 8 | **RLP 인코딩/디코딩** | EVM TX의 직렬화 포맷이다. unsigned TX → RLP → keccak256 해시 → KMS 서명 → signed TX = RLP(tx fields + v, r, s)로 이어지는 파이프라인에서 핵심 역할을 한다. | Solana TX는 자체 바이너리 직렬화 포맷을 사용한다. `[서명 배열 길이][서명들][message]` 구조이며, message 안에 header, account keys, recent blockhash, instructions가 포함된다. RLP과는 완전히 다른 구조다. | **높음.** tx-signer의 직렬화 로직을 완전 교체해야 한다. Solana SDK의 `Transaction.serialize()` 또는 Go용 Solana 라이브러리를 사용. 서명 입력도 `keccak256(RLP)` 해시 대신 직렬화된 message 바이트를 그대로 전달한다 (Ed25519는 MessageType=RAW). |
| 9 | **Plugin registry 패턴** | `blockchain/registry.go`에서 체인 타입별 구현체를 등록하는 패턴이다. 현재 "eth" 타입만 구현되어 있으며, 인터페이스에 `GetBlock(number)`, `GetNonce(address)`, `SendRawTransaction(hex)` 같은 EVM 전용 메서드가 노출되어 있을 수 있다. | Solana에서는 `GetBlock(slot)`, `GetDurableNonce(account)`, `SendTransaction(bytes)` 같은 다른 시그니처가 필요하다. 인터페이스가 EVM에 과도하게 결합되어 있으면 추상화 수준을 올려야 한다. | **중간.** registry 패턴 자체는 재사용 가능하지만, 인터페이스 정의를 검토해야 한다. 체인별 구현체가 구체적 로직을 처리하고, 상위 레이어는 체인 무관한 도메인 모델(Transfer, WithdrawalTx)만 다루도록 경계를 정리해야 한다. |

---

## 개발할 내용

### 1. 주소 검증/정규화 체인 추상화 (Address Validator)

**컴포넌트:** `common/address/`
**현재 상태:** hex 주소 검증이 하드코딩되어 있음
**변경 내용:**

```go
// 인터페이스 정의
type AddressValidator interface {
    Validate(address string) error
    Normalize(address string) string
    Format() string  // "hex" | "base58"
}

// EVM 구현
type EVMAddressValidator struct{}
func (v *EVMAddressValidator) Validate(addr string) error {
    // 0x prefix + 40자 hex + EIP-55 checksum
}

// Solana 구현
type SolanaAddressValidator struct{}
func (v *SolanaAddressValidator) Validate(addr string) error {
    // base58 디코딩 가능 + 32바이트 길이
}
```

**실패 케이스:** 잘못된 base58 문자열 (0, O, I, l 포함), 32바이트가 아닌 디코딩 결과
**모니터링:** `address_validation_error_total{chain="solana"}` 카운터

### 2. Nonce 관리 체인 추상화 (Nonce Strategy)

**컴포넌트:** `withdrawal/nonce/`
**현재 상태:** `wallets.current_nonce` atomic increment
**변경 내용:**

```go
type NonceStrategy interface {
    Acquire(ctx context.Context, walletID int64) (NonceInfo, error)
    Release(ctx context.Context, nonceInfo NonceInfo) error
    Cancel(ctx context.Context, nonceInfo NonceInfo) error
}

// EVM: 순차 정수 nonce
type EVMNonceStrategy struct{} // current_nonce++ atomic

// Solana: durable nonce 풀
type SolanaNonceStrategy struct{} // nonce 계정 풀에서 FREE 할당/반환
```

**Idempotency:** 같은 TX ID로 Acquire를 두 번 호출해도 동일 nonce가 반환되어야 한다 (재시작 안전성).

### 3. Transfer 추출 체인 추상화 (Transfer Extractor)

**컴포넌트:** `block-consumer/extractor/`
**현재 상태:** ERC20 event log 파싱 로직이 직접 구현되어 있음
**변경 내용:**

```go
type TransferExtractor interface {
    Extract(block RawBlock) ([]Transfer, error)
}

// EVM: event log 기반
type EVMTransferExtractor struct{}
// - native: tx.value > 0 + internal traces
// - ERC20: topic[0] == Transfer event sig
// - ERC721: topic[0] == Transfer event sig + tokenId

// Solana: balance diff 기반
type SolanaTransferExtractor struct{}
// - native SOL: preBalances vs postBalances
// - SPL Token: preTokenBalances vs postTokenBalances
// - 실패 TX(meta.err != null) 반드시 필터링
```

**핵심 차이:**
- EVM에서는 event log에 from/to/amount가 명시적으로 포함되지만, Solana에서는 balance diff를 계산해야 한다.
- Solana에서 fee payer의 잔액 변동에서 fee(5,000 lamports)를 분리해야 한다.
- 하나의 Solana TX에 여러 instruction이 포함될 수 있으므로, instruction 단위로 transfer를 추출해야 한다.

### 4. Fee 추정 체인 추상화 (Fee Estimator)

**컴포넌트:** `withdrawal/fee/`
**현재 상태:** `eth_gasPrice` 또는 `eth_maxPriorityFeePerGas` 호출
**변경 내용:**

```go
type FeeEstimator interface {
    Estimate(ctx context.Context) (FeeParams, error)
}

// EVM
type EVMFeeEstimator struct{} // maxFeePerGas, maxPriorityFeePerGas, gasLimit

// Solana
type SolanaFeeEstimator struct{} // computeUnitPrice, computeUnitLimit
// getRecentPrioritizationFees로 최근 priority fee 분포를 조회하고
// p50-p75 범위를 기본값으로 사용
```

### 5. TX 빌딩/직렬화 체인 추상화 (TX Builder)

**컴포넌트:** `withdrawal/txbuilder/`
**현재 상태:** RLP 인코딩 하드코딩
**변경 내용:**

EVM: `unsigned TX fields → RLP encode → keccak256 → KMS Sign(DIGEST) → RLP(fields + v,r,s)`
Solana: `TX message build → serialize → KMS Sign(RAW) → [signatures] + [message]`

두 경로가 공유하는 것은 "KMS Sign을 호출한다"는 추상 개념뿐이며, 입력/출력 형식이 완전히 다르므로 인터페이스보다는 각 체인별 독립 모듈로 구현하는 것이 적절하다.

---

## 공부할 내용

### 1. parentHash vs previousBlockhash - Reorg 감지의 동치성

EVM의 `parentHash`는 직전 블록의 keccak256 해시이고, Solana의 `previousBlockhash`는 직전 블록의 blockhash이다. 둘 다 "이전 블록이 무엇이었는지"를 가리키는 역할이 동일하다. 차이점은 EVM에서는 reorg가 실질적으로 발생하여 이 검증이 필수적이지만, Solana `finalized` commitment에서는 관측된 적이 없다. 그럼에도 방어적으로 RingBuffer를 유지하는 이유는, Solana 프로토콜이 명시적으로 "finalized에서 reorg 불가"를 보장하지는 않기 때문이다 (경제적으로 비실현적일 뿐).

### 2. 순차 nonce vs durable nonce - 동시성 모델의 근본적 차이

EVM의 순차 nonce는 단일 sender의 TX를 자연스럽게 직렬화한다. nonce=5가 채굴되기 전에는 nonce=6이 채굴될 수 없다. 이 덕분에 "동시 출금 N건"이라는 개념이 불필요하다 (순차 처리).

Solana의 durable nonce 풀은 각 nonce 계정이 독립적이므로, 풀 크기만큼 동시 출금이 가능하다. 하지만 풀 크기가 곧 동시 처리 한도이며, 부족하면 출금 큐에 대기가 발생한다. 이는 EVM에 없던 운영 관심사(capacity planning)를 도입한다.

핵심 질문: "핫월렛당 nonce 계정을 몇 개 사전 생성해야 하는가?" → 피크 동시 출금 수 + 20% 여유를 기준으로 한다. 비용은 개당 ~0.0015 SOL이므로 100개 = 0.15 SOL (~$30 @$200/SOL)로 저렴하다.

### 3. EIP-1559 vs Solana 로컬 Fee 시장 - 수수료 예측 패러다임

EVM의 글로벌 수수료 시장에서는 네트워크 전체의 혼잡도가 baseFee를 결정한다. NFT 민팅 이벤트가 일반 ETH 전송 비용까지 10배 이상 올릴 수 있다.

Solana의 로컬 수수료 시장에서는 각 프로그램(계정 집합)의 혼잡도가 독립적으로 수수료에 영향을 준다. Jupiter DEX의 트래픽 폭주가 우리 System Program 전송의 priority fee에는 거의 영향을 주지 않는다. 이는 수수료 예측의 안정성을 크게 높인다.

그러나 로컬 fee 시장의 단위가 다르다:
- EVM: `wei` (ETH의 10^-18), gas price는 Gwei (10^-9 ETH) 단위로 표시
- Solana: `micro-lamports` (SOL의 10^-15) per compute unit

### 4. event log vs balance diff - 토큰 전송 감지 패러다임

EVM의 event log는 컨트랙트가 명시적으로 발생시키는 이벤트이다. `Transfer(from, to, value)` 이벤트를 파싱하면 "누가 누구에게 얼마를 보냈는지" 바로 알 수 있다. 장점은 명시적이고 파싱이 간단하다는 것이고, 단점은 컨트랙트가 이벤트를 발생시키지 않으면 감지할 수 없다는 것이다.

Solana의 balance diff는 TX 전후의 잔액 스냅샷을 비교하는 방식이다. 어떤 instruction이 잔액을 변경했는지에 상관없이 "최종 결과"를 감지한다. 장점은 모든 잔액 변동을 포착한다는 것이고, 단점은 "누가 보냈는지"를 결정하기 위해 instruction을 분석해야 하며, fee 차감분과 실제 전송분을 분리해야 한다는 것이다.

### 5. mempool 유무에 따른 TX 라이프사이클 차이

EVM TX 라이프사이클:
```
사용자 전송 → mempool 진입 → 대기 → 마이너가 선택 → 블록에 포함 → confirmation 대기 → 확정
                ↑                                          
                └── 여기서 gas bump (replacement) 가능
```

Solana TX 라이프사이클:
```
사용자 전송 → 현재 리더에게 직접 전달 → 리더가 처리 → 블록에 포함 → commitment 진행
                ↑
                └── 리더가 못 받으면 그냥 드롭 (흔적 없음)
                    → 2초마다 재전송 필요
```

이 차이는 tx-sender와 tx-monitor의 설계에 근본적 영향을 준다. EVM에서는 "한 번 보내면 mempool에 있으니 기다리면 됨"이었지만, Solana에서는 "확인될 때까지 계속 보내야 함"이다.

### 6. RLP vs Solana 바이너리 포맷 - 직렬화 구조 차이

RLP(Recursive Length Prefix)은 중첩 가능한 바이트 배열을 인코딩하는 범용 포맷이다. EVM TX는 `[nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0]`을 RLP 인코딩한 뒤 keccak256 해시를 서명한다.

Solana TX는 고정 구조의 바이너리 포맷을 사용한다:
```
[compact-u16: 서명 개수][64바이트 서명 * N][message bytes]
message = [header: 3bytes][compact-u16: account 수][32바이트 pubkey * M]
          [32바이트 recent_blockhash][compact-u16: instruction 수][instructions...]
```

Ed25519는 서명 시 메시지를 먼저 SHA-512로 내부 해싱하므로, 외부에서 해시할 필요가 없다. KMS 호출 시 `MessageType: RAW`로 직렬화된 message 바이트를 그대로 전달한다.

### 7. 실패 TX 처리 차이

EVM에서 실패한 TX는 블록에 포함되고 gas가 소비되지만, 상태 변경은 롤백된다. receipt의 `status=0`으로 실패를 확인한다.

Solana에서 실패한 TX도 블록에 포함되고 base fee(5,000 lamports)가 소비된다. `meta.err`가 null이 아니면 실패다. Block Consumer에서 transfer를 추출할 때 반드시 `meta.err`를 먼저 확인하여 실패 TX를 필터링해야 한다. 이를 놓치면 실패한 전송을 입금으로 인식하는 치명적 버그가 발생한다.

### 8. 계정 모델 차이 - "주소만 있으면 수신 가능" 전제의 붕괴

EVM에서는 어떤 주소든 ETH나 ERC20 토큰을 받을 수 있다. 주소가 존재하기만 하면 된다.

Solana에서는 **계정이 온체인에 생성되어야** 수신이 가능하다:
- SOL 수신: 최소 rent-exempt 잔액 (~0.00089 SOL)이 있어야 한다. 없으면 시스템이 자동 생성하지만, sender가 rent-exempt 비용을 부담한다.
- SPL Token 수신: 해당 토큰의 **Associated Token Account(ATA)**가 미리 생성되어야 한다. 생성 비용 ~0.00204 SOL.
- ATA가 없는 상태에서 토큰을 보내면 **TX가 실패**한다.

이 차이는 입금 흐름과 출금 흐름 모두에 영향을 준다:
- 입금: deposit 지갑에 ATA를 사전 생성하거나, 첫 입금 시 자동 생성해야 한다.
- 출금: 수신자의 ATA 존재 여부를 확인하고, 없으면 TX에 `createAssociatedTokenAccountIdempotent` instruction을 포함해야 한다.

---

## 실습/검증 과제

### 과제 1: 기존 코드에서 EVM 전제 하드코딩 탐색

- [ ] `blockchain/registry.go`에서 인터페이스 메서드 시그니처를 확인하고, EVM 전용 파라미터(nonce, gasPrice 등)가 인터페이스 레벨에 노출되어 있는지 검사
- [ ] `block-consumer/`에서 `topic[0]` 매칭 로직을 찾아 ERC20 Transfer event signature 하드코딩 위치 파악
- [ ] `tx-ticketer/`에서 `current_nonce` 증가 로직을 찾아 nonce 관리가 어디까지 결합되어 있는지 확인
- [ ] DB 마이그레이션 파일에서 `VARCHAR(42)` 또는 `VARCHAR(66)` 같은 EVM 주소/해시 길이 제약 검색
- [ ] `tx-signer/`에서 RLP 인코딩 라이브러리 import와 keccak256 해시 사용 위치 파악

### 과제 2: Solana devnet에서 EVM 전제 붕괴 확인

- [ ] SOL transfer TX를 발생시키고 `getBlock` 응답에서 `previousBlockhash` 필드 존재 확인 (전제 #1)
- [ ] 동일 sender로 2건의 TX를 동시에 보내 nonce 순서 제약 없이 둘 다 확인되는지 확인 (전제 #2)
- [ ] `getRecentPrioritizationFees` 응답 구조를 확인하여 EIP-1559와의 차이 기록 (전제 #3)
- [ ] base58 주소를 생성하고 길이 범위(32-44자) 확인 (전제 #4)
- [ ] SPL Token transfer의 `preTokenBalances`/`postTokenBalances` 구조 확인 (전제 #5)
- [ ] 실패 TX를 의도적으로 발생시키고 `meta.err` 필드 구조 확인 (전제 #7)
- [ ] ATA가 없는 주소에 SPL Token을 보내 TX 실패 확인 (전제 #8)

### 과제 3: Acceptance Criteria

- [ ] 9개 EVM 전제 각각에 대해 "Solana에서 깨지는 이유"와 "대응 방법"을 한 문단으로 작성 완료
- [ ] 최소 3개 전제에 대해 devnet 실제 응답으로 차이를 검증 완료 (fixture 저장)
- [ ] 기존 코드에서 EVM 전제 하드코딩 위치를 파일/라인 수준으로 5개 이상 식별 완료

---

## 완료 기준

- 9개 EVM 전제 조건 각각에 대해 "왜 존재하는가", "Solana에서 어떻게 깨지는가", "마이그레이션 영향도"가 표 형태로 정리되어 있다.
- 영향도 높음(nonce, event log, mempool, RLP)으로 분류된 항목에 대해 구체적 코드 변경 범위가 명시되어 있다.
- 기존 코드에서 EVM 전제가 하드코딩된 위치를 5개 이상 식별했다.
- 최소 3개 전제에 대해 Solana devnet 실제 응답으로 차이를 검증했다.
- 체인 추상화가 필요한 인터페이스(AddressValidator, NonceStrategy, TransferExtractor, FeeEstimator)의 시그니처 초안이 작성되어 있다.
