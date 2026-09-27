import {deletionStatusMessage} from './deletionStatus';
test('acceptance, missing status, retries and completion are distinct',()=>{
 expect(deletionStatusMessage({state:'pending'})).toContain('22-minute');
 expect(deletionStatusMessage({state:'missing'})).toContain('does not confirm deletion');
 expect(deletionStatusMessage({state:'retrying'})).toContain('retried');
 expect(deletionStatusMessage({state:'complete'})).toContain('completed');
 expect(deletionStatusMessage({state:'expired'})).toContain('no longer');
});
