import React, { useEffect, useState } from 'react'
import { Plus, Calendar, ExternalLink, Trash2, Repeat, Bell } from 'lucide-react'
import TaskCreateModal from './TaskCreateModal'
import TaskDetailModal from './TaskDetailModal'

const STATUS_COLS = [
  { key: 'todo',        label: 'Da fare',     color: '#6C3CE1' },
  { key: 'in_progress', label: 'In corso',    color: '#3b82f6' },
  { key: 'done',        label: 'Completato',  color: '#10b981' },
  { key: 'archived',    label: 'Archiviato',  color: '#606080' }
]

const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' }
const PRIORITY_LABELS = { high: 'Alta', medium: 'Media', low: 'Bassa' }

export default function TaskView({ accountId, onNavigate }) {
  const [tasks, setTasks] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [editTask, setEditTask] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)

  useEffect(() => {
    loadTasks()
    const off = window.api.on?.('notification:task-click', ({ taskId }) => {
      window.api.getTasks({}).then(list => {
        const t = list.find(x => x.id === taskId)
        if (t) setEditTask(t)
      })
    })
    return () => off?.()
  }, [])

  const loadTasks = async () => setTasks(await window.api.getTasks({}))

  const handleUpdateStatus = async (taskId, status) => {
    await window.api.updateTask(taskId, { status })
    loadTasks()
  }

  const handleDelete = async (taskId, e) => {
    e?.stopPropagation()
    if (!confirm('Eliminare questo task?')) return
    await window.api.deleteTask(taskId)
    loadTasks()
  }

  const tasksByStatus = (status) => tasks.filter(t => t.status === status)

  const onDragStart = (e, taskId) => {
    e.dataTransfer.setData('text/plain', String(taskId))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e, colKey) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverCol !== colKey) setDragOverCol(colKey)
  }

  const onDragLeave = (e) => {
    if (e.currentTarget === e.target) setDragOverCol(null)
  }

  const onDrop = async (e, status) => {
    e.preventDefault()
    setDragOverCol(null)
    const taskId = parseInt(e.dataTransfer.getData('text/plain'), 10)
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status === status) return
    await handleUpdateStatus(taskId, status)
  }

  return (
    <>
      <div className="main-header">
        <div className="main-header__info">
          <div className="main-header__name">✅ Task / To-Do</div>
        </div>
        <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Nuovo Task
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 16, padding: 20, overflow: 'auto' }}>
        {STATUS_COLS.map(col => (
          <div key={col.key}
            onDragOver={e => onDragOver(e, col.key)}
            onDragLeave={onDragLeave}
            onDrop={e => onDrop(e, col.key)}
            style={{
              flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8,
              padding: 8, borderRadius: 8,
              background: dragOverCol === col.key ? 'var(--accent-light)' : 'transparent',
              transition: 'background 0.15s'
            }}>
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: `2px solid ${col.color}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>{col.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderRadius: 10, padding: '1px 8px' }}>
                {tasksByStatus(col.key).length}
              </span>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
              {tasksByStatus(col.key).map(task => (
                <div key={task.id}
                  draggable
                  onDragStart={e => onDragStart(e, task.id)}
                  onClick={() => setEditTask(task)}
                  style={{
                    background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: 12,
                    border: '1px solid var(--border)', cursor: 'grab', transition: 'var(--transition)'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{task.title}</span>
                    <button className="btn--icon" style={{ width: 20, height: 20 }}
                      onClick={(e) => handleDelete(task.id, e)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {task.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>
                      {task.description.slice(0, 80)}{task.description.length > 80 ? '...' : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {task.priority && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                        background: PRIORITY_COLORS[task.priority] + '22', color: PRIORITY_COLORS[task.priority]
                      }}>
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                    )}
                    {task.due_date && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Calendar size={10} /> {new Date(task.due_date).toLocaleDateString('it-IT')}
                      </span>
                    )}
                    {task.source_message_id && (
                      <span style={{ fontSize: 10, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <ExternalLink size={10} /> Messaggio
                      </span>
                    )}
                    {task.recurrence_type && task.recurrence_type !== 'once' && (
                      <span style={{ fontSize: 10, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Repeat size={10} /> {task.recurrence_type}
                      </span>
                    )}
                    {task.notify === 1 && (
                      <span style={{ fontSize: 10, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Bell size={10} /> Notifica
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {tasksByStatus(col.key).length === 0 && (
                <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', opacity: 0.6 }}>
                  Trascina qui i task
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <TaskCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={loadTasks}
        />
      )}

      {editTask && (
        <TaskDetailModal
          task={editTask}
          onClose={() => setEditTask(null)}
          onSaved={loadTasks}
          onDeleted={loadTasks}
          onNavigateToMessage={async (messageId) => {
            const msg = await window.api.getMessageById(messageId)
            if (msg) {
              setEditTask(null)
              onNavigate?.('chat', { contactId: msg.contact_id, messageId: msg.id })
            }
          }}
        />
      )}
    </>
  )
}
