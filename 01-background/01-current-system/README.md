# 현재 시스템 (Dagaon Core)

상위 섹션: [1. 배경](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

Dagaon Core는 EVM 호환 체인(Ethereum, Kaia, BSC, Tron)을 지원하는 커스터디얼 지갑 시스템이다.
**입금 파이프라인:**
Blockchain Node → Block Publisher → Kafka + S3 → Block Consumer → MySQL → Event Confirmer
**출금 파이프라인:**
API Request → tx-ticketer → tx-signer (KMS) → tx-sender → tx-monitor
**핵심 컴포넌트:**
| 컴포넌트 | 역할 |
|----------|------|
| Block Publisher | 블록 데이터 수집, Kafka/S3 적재, reorg 감지 (RingBuffer + parentHash) |
| Block Consumer | Kafka에서 블록 소비, transfer 추출 (native/ERC20/ERC721), 감시 지갑 매칭 |
| Event Confirmer | `last_block - confirmation_blocks` 기반 finality 확정 |
| tx-ticketer | 출금 요청 수신, 순차 nonce 할당 (2-phase atomic) |
| tx-signer | AWS KMS로 secp256k1 서명, RLP 인코딩 |
| tx-sender | `eth_sendRawTransaction` 브로드캐스트 |
| tx-monitor | stuck TX 감지, gas bump, 재전송 |
| KMS | AWS KMS 기반 키 관리 (secp256k1) |
| ReplicationManager | etcd lease 기반 distributed lock (HA) |

## 개발할 내용

1. 원문 내용을 구현 backlog와 검증 과제로 분해한다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. 핵심 개념을 공식 문서와 실제 샘플로 확인한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. 작은 PoC 또는 체크리스트를 만들어 완료 기준을 명확히 한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
