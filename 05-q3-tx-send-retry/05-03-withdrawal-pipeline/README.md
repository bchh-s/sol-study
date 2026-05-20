# 5.3 출금 파이프라인 비교 (EVM vs Solana)

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**EVM (현재):**
tx-ticketer:
  1. 요청 획득 (FOR UPDATE SKIP LOCKED)
  2. Phase 1: 요청 상태 PROCESSING, TX row 생성
  3. Phase 2: nonce 할당 (current_nonce++ atomic), gas 조회
  → unsigned TX 생성
tx-signer:
  1. RLP 인코딩 → keccak256 해시
  2. KMS Sign (ECDSA)
  3. DB 저장 (tx_hash, signed_tx, status=SIGNED) ← 반드시 브로드캐스트 전
tx-sender:
  1. eth_sendRawTransaction
  2. "already known" / "nonce too low" → BROADCASTED
  3. "replacement underpriced" → gas bump 필요
  4. timeout → retry_at 설정
tx-monitor:
  1. stuck TX 폴링 (retry_at <= NOW())
  2. BROADCASTED + stuck → gas bump (+10%), 새 TX row (RETRIED → PENDING)
  3. receipt 확인 → COMPLETED
**Solana (변경):**
tx-preparer (tx-ticketer 대체):
  1. 요청 획득 (동일)
  2. nonce 풀에서 free nonce 계정 할당 (status=in_use)
  3. nonce 계정의 storedNonce 값 조회 (getNonce RPC)
  4. compute unit limit/price 조회 (getRecentPrioritizationFees)
  → unsigned TX 생성 (AdvanceNonce + Transfer)
tx-signer:
  1. Solana TX message serialize

## 개발할 내용

1. durable nonce 기반 TX builder/sender/monitor 상태 전이를 구현 계획으로 쪼갠다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. recent blockhash 만료, durable nonce, retry/drop 모델을 학습한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. devnet에서 nonce advance + transfer + signature status 확인을 실행한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
