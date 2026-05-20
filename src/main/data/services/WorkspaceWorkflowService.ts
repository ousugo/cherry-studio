import { application } from '@application'
import { sessionService } from '@data/services/SessionService'
import { workspaceService } from '@data/services/WorkspaceService'

export class WorkspaceWorkflowService {
  async deleteWorkspace(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      await workspaceService.getRowByIdTx(tx, id)
      await sessionService.deleteByWorkspaceTx(tx, id)
      await workspaceService.deleteByIdTx(tx, id)
    })
  }
}

export const workspaceWorkflowService = new WorkspaceWorkflowService()
