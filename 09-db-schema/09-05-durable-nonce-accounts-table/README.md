# 9.5 durable_nonce_accounts 테이블 (신규)

상위 섹션: [9. DB 스키마 영향](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

CREATE TABLE solana_durable_nonce_accounts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  wallet_id BIGINT NOT NULL,               -- 소유 핫월렛
  nonce_account_address VARCHAR(44) NOT NULL,
  authority_address VARCHAR(44) NOT NULL,   -- nonce authority (= 핫월렛)
  stored_nonce VARCHAR(44),                 -- 현재 저장된 nonce 값
  status TINYINT DEFAULT 1,                 -- 1=FREE, 2=IN_USE, 3=DISABLED
  in_use_by_tx_id BIGINT,                  -- 사용 중인 TX ID
  UNIQUE KEY uk_nonce (chain_id, nonce_account_address),
  INDEX idx_wallet_status (wallet_id, status),
  FOREIGN KEY (wallet_id) REFERENCES solana_wallets(id)
);
---

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
