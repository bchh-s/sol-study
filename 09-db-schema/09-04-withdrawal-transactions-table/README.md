# 9.4 withdrawal_transactions 테이블

상위 섹션: [9. DB 스키마 영향](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**Solana (제안):**
CREATE TABLE solana_withdrawal_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  chain_id BIGINT NOT NULL,
  fee_payer_address VARCHAR(44) NOT NULL,   -- 핫월렛 (fee payer)
  from_address VARCHAR(44) NOT NULL,
  to_address VARCHAR(44) NOT NULL,
  mint_address VARCHAR(44),                 -- SPL token이면 설정
  amount VARCHAR(100) NOT NULL,
  -- Solana 고유 필드
  durable_nonce_account VARCHAR(44),        -- 사용 중인 nonce 계정
  nonce_value VARCHAR(44),                  -- storedNonce 값
  compute_unit_limit INT,
  compute_unit_price BIGINT,                -- micro-lamports
  tx_signature VARCHAR(88),                 -- 서명 후 설정
  signed_tx TEXT,                           -- serialized signed TX
  -- 상태 관리
  status TINYINT DEFAULT 1,                 -- 1=PENDING, 2=SIGNED, 3=BROADCASTED, 4=RETRIED, 5=COMPLETED, 6=DROPPED
  retry_at TIMESTAMP,
  signed_at TIMESTAMP,

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
