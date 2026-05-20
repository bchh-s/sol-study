# 9.1 blocks 테이블

상위 섹션: [9. DB 스키마 영향](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**EVM (현재):**
CREATE TABLE blocks (
  chain_id BIGINT NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  parent_hash VARCHAR(66) NOT NULL,
  block_timestamp BIGINT NOT NULL,
  status TINYINT DEFAULT 1,  -- 1=active, 2=reorged
  PRIMARY KEY (chain_id, block_number)
);
**Solana (제안):**
CREATE TABLE solana_blocks (
  chain_id BIGINT NOT NULL,
  slot_number BIGINT NOT NULL,
  block_height BIGINT NOT NULL,
  blockhash VARCHAR(44) NOT NULL,
  previous_blockhash VARCHAR(44) NOT NULL,
  parent_slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL,
  status TINYINT DEFAULT 1,  -- 1=active (reorg 사실상 없음)
  PRIMARY KEY (chain_id, slot_number),
  INDEX idx_block_height (chain_id, block_height),
  INDEX idx_blockhash (chain_id, blockhash)
);

## 개발할 내용

1. slot scanner와 transfer extractor 테스트 fixture를 만든다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. slot/blockHeight/commitment/finality 및 balance diff 추출 방식을 학습한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. 최근 finalized slot block JSON을 받아 SOL/SPL transfer를 수작업 검증한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
