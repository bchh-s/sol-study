# 3.5 Transfer 추출 방식 비교

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**EVM (현재):**
- Native 전송: `tx.value > 0` 확인 + internal transaction traces
- ERC20: `Transfer(address,address,uint256)` event log 파싱 (topic0 매칭)
- ERC721: 같은 Transfer event이나 token ID 포함
**Solana (변경):**
- Native SOL 전송: `preBalances` vs `postBalances` 배열 비교
- SPL Token 전송: `preTokenBalances` vs `postTokenBalances` 비교
  - mint address, owner, amount 정보 포함
- NFT: SPL Token과 동일 메커니즘 (supply=1인 mint)
- **실패한 TX는 반드시 `meta.err` 확인 후 제외** (EVM과 달리 실패 TX도 블록에 포함됨)
Transfer 고유 식별자 변경:
EVM:   (chain_id, block_hash, tx_hash, transfer_type, log_index, trace_address)
Solana: (chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index)

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
