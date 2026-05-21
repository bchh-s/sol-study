# Solana 공식 문서

상위 섹션: [15. 참고자료](../README.md)

---

## 핵심 개념 문서

### Solana Transactions

- **URL:** https://solana.com/docs/core/transactions
- **다루는 내용:** Solana 트랜잭션의 구조 -- message, signatures, instructions, account keys, recent blockhash. Versioned transactions(v0)와 Address Lookup Tables도 포함.
- **언제 참고:** TX 구성(tx-preparer) 구현 시, instruction 순서 이해 시, versioned transaction 지원 여부 결정 시
- **Dagaon 영향:**
  - TX message 직렬화 방식이 EVM과 완전히 다름 → 새로운 TX builder 필요
  - durable nonce 사용 시 nonceAdvance가 첫 번째 instruction이어야 함
  - feePayer 필드가 TX 구조에 네이티브로 존재 → fee delegation 단순화

### Solana Fees

- **URL:** https://solana.com/docs/core/fees
- **다루는 내용:** base fee(5,000 lamports/signature), priority fee(compute unit price), compute unit budget. 수수료 계산 방식과 로컬 수수료 시장.
- **언제 참고:** 수수료 산정 로직 구현 시, priority fee 동적 조정 구현 시, 실패 TX 수수료 회계 처리 시
- **Dagaon 영향:**
  - base fee가 고정이므로 EVM의 동적 gas price 추정 로직 불필요
  - priority fee만 동적 조정 → `getRecentPrioritizationFees` 사용
  - 실패 TX도 수수료 소비 → 회계 로직에 반영 필수 (Risk 5)

### Durable Nonces

- **URL:** https://solana.com/docs/core/transactions/durable-nonces
- **다루는 내용:** durable nonce 계정 생성, nonce advance, TX에서의 사용법. nonce 값이 blockhash 대신 사용되는 메커니즘.
- **언제 참고:** 출금 파이프라인 설계 시, nonce pool 관리 구현 시, TX 취소 메커니즘 구현 시
- **Dagaon 영향:**
  - 출금의 핵심 메커니즘 (ADR-2)
  - nonce 계정 생성 비용 (~0.0015 SOL) 및 관리 운영 복잡성
  - nonceAdvance가 TX 첫 번째 instruction이어야 하는 제약

---

## RPC API 문서

### RPC HTTP Methods

- **URL:** https://solana.com/docs/rpc/http
- **다루는 내용:** 모든 HTTP RPC 메서드 목록과 파라미터. getBlock, getBlocks, getSlot, sendTransaction, getSignatureStatuses, getBalance, getTokenAccountBalance 등.
- **언제 참고:** RPC 클라이언트 래퍼 구현 시 (Phase 1, Week 2), 모든 RPC 호출의 레퍼런스
- **Dagaon 영향:**
  - Block Publisher: `getSlot`, `getBlocks`, `getBlock`
  - TX Sender: `sendTransaction`, `getSignatureStatuses`
  - Balance 조회: `getBalance`, `getTokenAccountBalance`
  - commitment 파라미터를 모든 호출에 명시해야 함

### RPC WebSocket Methods

- **URL:** https://solana.com/docs/rpc/websocket
- **다루는 내용:** WebSocket 구독 메서드. signatureSubscribe, accountSubscribe, slotSubscribe 등.
- **언제 참고:** TX 상태 실시간 모니터링 구현 시 (Phase 3, Week 9)
- **Dagaon 영향:**
  - `signatureSubscribe`: TX 확정을 실시간으로 감지 (폴링 대비 효율적)
  - `accountSubscribe`: 특정 계정의 잔액 변경 감지 (입금 모니터링 대안)
  - WebSocket 연결 관리 (재연결, heartbeat) 구현 필요

---

## 가이드 문서

### Transaction Confirmation & Expiration

- **URL:** https://solana.com/developers/guides/advanced/confirmation
- **다루는 내용:** commitment level(processed/confirmed/finalized)의 상세 정의, blockhash 만료 메커니즘, TX 확인 전략.
- **언제 참고:** ADR-1(commitment level 결정), Block Publisher 설계, TX 상태 모니터링 구현 시
- **Dagaon 영향:**
  - finalized commitment 사용 결정의 기술적 근거 (ADR-1)
  - blockhash ~150블록 후 만료 → durable nonce 필요성의 근거 (ADR-2)
  - TX 확인 흐름: processed → confirmed → finalized

### Retrying Transactions

- **URL:** https://solana.com/developers/guides/advanced/retry
- **다루는 내용:** TX 재전송 전략, skipPreflight 사용 이유, maxRetries 파라미터, 재전송 간격 권장사항.
- **언제 참고:** TX Sender 재전송 루프 구현 시 (Phase 3, Week 9), TX 랜딩 안정성 확보 시
- **Dagaon 영향:**
  - `skipPreflight: true` 권장 → 프리플라이트 검증이 리더 상태와 다를 수 있음
  - 2초 간격 재전송이 권장 패턴
  - RPC 노드의 `maxRetries` 파라미터는 RPC 측 재전송 (우리 재전송과 별개)

### Add Solana to Your Exchange

- **URL:** https://solana.com/developers/guides/advanced/exchange
- **다루는 내용:** 거래소/결제 서비스의 Solana 통합 가이드. 입금 감지 방법, 출금 구현 방법, 보안 권장사항.
- **언제 참고:** 전체 아키텍처 설계 시, 입금/출금 파이프라인 설계 시
- **Dagaon 영향:**
  - finalized commitment 사용 권장 (ADR-1의 근거)
  - balance diff 방식의 입금 감지 패턴 (Block Consumer 구현 방식)
  - 핫/콜드 월렛 분리 패턴
  - SPL 토큰 처리 가이드 (ATA 관리 포함)

### EVM to SVM Complete Guide

- **URL:** https://solana.com/developers/evm-to-svm/complete-guide
- **다루는 내용:** EVM 개발자를 위한 Solana 전환 가이드. 계정 모델 차이, 프로그램(스마트 컨트랙트) 차이, TX 구조 차이 등.
- **언제 참고:** 팀 온보딩 시, EVM 개념과 Solana 개념의 매핑이 필요할 때
- **Dagaon 영향:**
  - EVM의 EOA vs Contract → Solana의 Program vs Account 매핑 이해
  - EVM의 storage vs Solana의 account data 패턴 이해
  - 팀원들의 Solana 학습 가이드 역할
