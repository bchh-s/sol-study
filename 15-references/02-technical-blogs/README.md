# 기술 블로그

상위 섹션: [15. 참고자료](../README.md)

---

## Helius 블로그 시리즈

Helius는 Solana의 대표적인 RPC 제공자이자 인프라 회사로, 실전 운영 경험에 기반한 기술 블로그를 운영한다.

### Understanding Slots, Blocks, and Epochs

- **URL:** https://www.helius.dev/blog/solana-slots-blocks-and-epochs
- **핵심 내용:**
  - Solana의 시간 단위: Slot(~400ms) → Block → Epoch(~2-3일)
  - 슬롯과 블록의 관계: 모든 슬롯에 블록이 있지는 않음 (skipped slots)
  - 리더 스케줄: 각 에포크마다 리더 순서가 미리 결정됨
  - 에포크 전환 시 스테이크 재계산
- **핵심 Takeaway:**
  - Block Publisher에서 빈 슬롯 처리가 필수 → `getBlocks`로 존재하는 슬롯만 조회
  - 슬롯 번호가 곧 시간 축 → EVM의 block number와 유사하지만 갭 존재
  - 에포크 경계에서 특별한 처리는 불필요 (입금/출금 파이프라인에 영향 없음)
- **관련 섹션:** [Section 5: 블록 구조](../../05-block-structure/README.md), [Phase 2: Block Publisher](../../13-implementation-phases/README.md)

### Solana Commitment Levels

- **URL:** https://www.helius.dev/blog/solana-commitment-levels
- **핵심 내용:**
  - processed / confirmed / finalized의 정확한 차이
  - 각 level에서의 지연 시간 실측값
  - Tower BFT 합의 메커니즘과 commitment level의 관계
  - 어떤 상황에서 어떤 level을 사용해야 하는지 가이드
- **핵심 Takeaway:**
  - finalized는 실측 ~12-13초 지연 (공식 문서보다 구체적인 수치)
  - confirmed → finalized 사이에 reorg 발생 확률은 이론적으로만 존재
  - 거래소/결제에는 무조건 finalized 사용 권장
  - processed는 UI 미리보기 등에만 사용
- **관련 섹션:** [ADR-1: 입금 Commitment Level](../../12-adr/adr-01-deposit-commitment/README.md)

### How to Land Transactions on Solana

- **URL:** https://www.helius.dev/blog/how-to-land-transactions-on-solana
- **핵심 내용:**
  - Solana TX가 드롭되는 모든 시나리오 (리더 로테이션, 큐 오버플로우, 네트워크 혼잡)
  - TX 랜딩 성공률을 높이는 전략: priority fee, skipPreflight, 재전송 루프
  - Staked connections vs unstaked connections의 차이
  - Jito bundles를 통한 TX 랜딩 보장 (MEV 관련)
  - 실전에서의 TX 랜딩률 통계
- **핵심 Takeaway:**
  - `skipPreflight: true`가 거의 필수 → 프리플라이트는 오히려 지연만 추가
  - Priority fee는 `getRecentPrioritizationFees`로 동적 결정
  - 재전송 간격 2초가 실전에서 검증된 패턴
  - Staked connection을 사용하면 TX 전달 우선권 확보 (Helius 등 프리미엄 RPC)
  - TX 랜딩률 목표: 95% 이상 (재전송 포함)
- **관련 섹션:** [Risk 1: TX 랜딩 안정성](../../11-risk-assessment/01-high-risks/README.md), [Phase 3: TX Sender](../../13-implementation-phases/README.md)

---

## KMS/보안 블로그

### How to Manage a Million Dollars on Solana with Cloud KMS

- **URL:** https://www.turfemon.com/solana-kms-signing
- **핵심 내용:**
  - AWS/GCP Cloud KMS를 사용한 Solana 트랜잭션 서명 구현
  - Ed25519 키 생성 → 공개키 추출 → 주소 변환 과정
  - DER 인코딩된 공개키에서 raw 32 bytes 추출하는 방법
  - 서명 시 MessageType: RAW 사용 (DIGEST가 아님) 주의사항
  - 프로덕션에서의 키 관리 베스트 프랙티스
- **핵심 Takeaway:**
  - Ed25519 DER 공개키에서 raw bytes 추출: 마지막 32 bytes (DER 헤더 길이 고정)
  - `MessageType: RAW` 필수 -- Ed25519는 메시지 해시가 아닌 원본에 서명
  - KMS 호출 지연: p50 ~80ms, p99 ~200ms (us-east-1 기준)
  - 키 로테이션: Solana 주소가 곧 공개키이므로 로테이션 시 주소 변경됨
  - 비용: $1/key/month + API 호출 비용 (무시 가능 수준)
- **관련 섹션:** [Phase 1: KMS Ed25519](../../13-implementation-phases/README.md), [Risk 7: KMS 통합](../../11-risk-assessment/03-low-risks/README.md)

---

## Fee Delegation 블로그

### Fee Payers and Gasless Transactions on Solana (Circle)

- **URL:** https://www.circle.com/blog/how-circles-gas-station-uses-fee-payers-to-enable-gasless-transactions-on-solana
- **핵심 내용:**
  - Solana의 feePayer 메커니즘을 활용한 가스리스 트랜잭션 구현
  - Circle의 Gas Station 서비스 아키텍처
  - EVM의 meta-transaction/paymaster 대비 Solana fee delegation의 단순함
  - partial signing 패턴: 사용자가 서명 → fee payer가 추가 서명
  - 프로덕션 규모에서의 fee payer 관리
- **핵심 Takeaway:**
  - feePayer는 TX의 첫 번째 signer (서명 순서 주의)
  - partial signing: `transaction.partialSign(userKeypair)` → `transaction.partialSign(feePayerKeypair)`
  - fee payer 지갑의 SOL 잔액 모니터링 필수 → 잔액 부족 시 모든 TX 실패
  - Dagaon Core에서는 핫월렛이 항상 fee payer → Circle의 Gas Station과 유사한 패턴
  - EVM에서 필요한 Relayer/Paymaster 인프라가 Solana에서는 불필요
- **관련 섹션:** [오히려 좋아지는 것: Fee Delegation](../../14-conclusion/03-improvements/README.md)
