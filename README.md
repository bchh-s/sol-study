# Dagaon Core - Solana 통합 리서치 & 학습 워크스페이스

> Dagaon Core (EVM 기반 커스터디얼 지갑) → Solana 체인 통합을 위한 기술 리서치, 학습 문서, 실습 코드

## 리서치 원문

- [solana-integration-research.md](./solana-integration-research.md) — 전체 리서치 보고서 (1,000줄, EVM↔Solana 비교 분석)

---

## 학습 문서 (01~15)

각 섹션은 README.md에 상세 내용이 작성되어 있으며, 하위 디렉토리에 세부 토픽이 있습니다.

### 배경 & 비교

| # | 섹션 | 내용 | 하위 문서 |
|---|------|------|----------|
| 01 | [배경](./01-background/README.md) | Dagaon Core 아키텍처, EVM 전제조건 분석 | 2개 |
| 02 | [EVM vs Solana](./02-evm-vs-solana/README.md) | 18차원 비교표, 각 차이의 구현 결정 | - |

### 4대 핵심 질문

| # | 섹션 | 내용 | 하위 문서 | 실습 코드 |
|---|------|------|----------|----------|
| 03 | [Block Sync](./03-q1-block-sync/README.md) | Slot 모델, 스캐닝 비교, reorg, transfer 추출 | 7개 | [block-scanner.ts](./03-q1-block-sync/code/block-scanner.ts) |
| 04 | [KMS](./04-q2-kms-solana/README.md) | Ed25519 서명, AWS KMS 설정, 주소 도출, 듀얼체인 | 6개 | [key-signing-demo.ts](./04-q2-kms-solana/code/key-signing-demo.ts) |
| 05 | [TX 전송/재시도](./05-q3-tx-send-retry/README.md) | Durable nonce, 출금 파이프라인, nonce 풀 관리 | 6개 | [durable-nonce-demo.ts](./05-q3-tx-send-retry/code/durable-nonce-demo.ts) |
| 06 | [Fee Delegation](./06-q4-fee-delegation/README.md) | Fee payer 모델, EVM 비교, 커스터디얼 적용 | 5개 | - |

### Solana 기초

| # | 섹션 | 내용 | 하위 문서 | 실습 코드 |
|---|------|------|----------|----------|
| 07 | [Solana 기초](./07-solana-basics/README.md) | PoH/Tower BFT, 계정 모델, ATA, TX 구조, 프로그램 | 5개 | [account-explorer.ts](./07-solana-basics/code/account-explorer.ts) |

### 아키텍처 & 설계

| # | 섹션 | 내용 | 하위 문서 |
|---|------|------|----------|
| 08 | [컴포넌트 영향도](./08-component-impact/README.md) | 15개 컴포넌트 매트릭스, 의존성 그래프, feature flag 전략 | - |
| 09 | [DB 스키마](./09-db-schema/README.md) | 5개 Solana 전용 테이블 DDL, 컬럼별 EVM 비교 | 6개 |
| 10 | [RPC API](./10-rpc-api/README.md) | 18개 HTTP + 6개 WebSocket 메서드 상세, 프로바이더 비교 | 5개 | 
| 11 | [리스크 평가](./11-risk-assessment/README.md) | 8개 리스크 (높음/중간/낮음), 대응/탐지/복구 | 3개 |
| 12 | [ADR](./12-adr/README.md) | 4개 아키텍처 결정 (finalized, durable nonce, 테이블 분리, Confirmer 생략) | 4개 |
| 13 | [구현 페이즈](./13-implementation-phases/README.md) | 12주 4단계 로드맵, 주간 태스크, 종료 기준 | - |
| 14 | [결론](./14-conclusion/README.md) | 재사용/신규/개선 정량 분석 | 3개 |
| 15 | [참고자료](./15-references/README.md) | 공식 문서, 블로그, AWS KMS, 라이브러리 | 4개 |

---

## 실습 코드

### Devnet 예제 (examples/)

순서대로 실행하면 Solana devnet에서 전체 흐름을 체험할 수 있습니다.

```bash
cd examples && npm install

npm run 01  # 계정 3개 생성 (Ed25519 키페어 → base58 주소)
npm run 02  # SOL airdrop (devnet faucet)
npm run 03  # SPL 토큰 Mint 생성 + ATA 생성 + 민팅
npm run 04  # Native SOL 전송 + balance diff 분석
npm run 05  # SPL 토큰 전송 (고수준 API + ATA 자동생성 atomic batch)
npm run 06  # Fee Payer 지정 (SOL 전송 + 토큰 전송 모두)
npm run 07  # TX 모니터링 + 블록 파싱 + 주소 히스토리
```

### 섹션별 실습 코드

| 코드 | 위치 | 검증 내용 |
|------|------|----------|
| Block Scanner | [`03-q1-block-sync/code/`](./03-q1-block-sync/code/) | finalized 슬롯 스캐닝, SOL/SPL transfer 추출, previousBlockhash 검증 |
| Key Signing Demo | [`04-q2-kms-solana/code/`](./04-q2-kms-solana/code/) | Ed25519 키 생성, DER→base58 주소 도출, 서명/검증 |
| Durable Nonce Demo | [`05-q3-tx-send-retry/code/`](./05-q3-tx-send-retry/code/) | Nonce 계정 생성, nonce 기반 TX, 취소(nonce advance) |
| Account Explorer | [`07-solana-basics/code/`](./07-solana-basics/code/) | 계정 5필드, Mint 디코딩, ATA, PDA 도출, Rent 계산 |
| RPC Explorer | [`10-rpc-api/code/`](./10-rpc-api/code/) | 18개 RPC 호출 + WebSocket + fixture JSON 저장 |

각 코드 디렉토리에서:
```bash
npm install && npx tsx <파일명>.ts
```

---

## 추천 학습 순서

```
1단계: 기초 이해
  07-solana-basics     → Solana 핵심 개념 (계정, TX, 프로그램)
  02-evm-vs-solana     → EVM과 1:1 비교
  examples/ 01~03      → devnet에서 직접 체험

2단계: 입금 파이프라인
  03-q1-block-sync     → Slot 스캐닝, transfer 추출
  10-rpc-api           → RPC 메서드 상세
  examples/ 04~05      → 전송 + 잔액 변화 관찰

3단계: 출금 파이프라인
  04-q2-kms-solana     → Ed25519 서명, KMS 통합
  05-q3-tx-send-retry  → Durable nonce, 재전송 전략
  06-q4-fee-delegation → Fee payer, 커스터디얼 모델
  examples/ 06         → fee payer 실습

4단계: 설계 & 계획
  09-db-schema         → Solana 전용 테이블 설계
  08-component-impact  → 컴포넌트별 영향도
  11-risk-assessment   → 리스크 평가
  12-adr               → 아키텍처 결정
  13-implementation    → 12주 로드맵
```

---

## 핵심 결론 요약

| 질문 | 답변 |
|------|------|
| Block Sync 가능? | **가능.** `getBlocks()` + `getBlock()`으로 슬롯 스캐닝. Kafka/S3 재사용. finalized에서 reorg 없음 |
| KMS 지원? | **가능.** AWS KMS Ed25519 네이티브 지원 (2025.11~). 동일 인스턴스에서 EVM+Solana |
| TX 전송? | **Durable Nonce 필수.** Mempool 없음 → 2초 재전송. recent blockhash 60-90초 만료 부적합 |
| Fee Delegation? | **네이티브 지원.** `tx.feePayer = 지갑` 한 줄. EVM의 meta-tx보다 훨씬 간단 |
