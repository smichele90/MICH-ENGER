import React, { useState, useEffect } from 'react'
import { Plus, Calendar, Flag, Tag, X, ChevronDown, ExternalLink, Trash2, Repeat, Bell } from 'lucide-react'
import TaskCreateModal from './TaskCreateModal'

const STATUS_COLS = [
  { key: 'todo', label: 'Da fare', color: '#6C3CE1' },
  { key: 'in_progress', label: 'In corso', color: '#3b82f6' },
  { key: 'done', label: 'Completato', color: '#10b981' },
  { key: 'archived', label: 'Archiviato', color: '#606080' }
]

const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' }
const PRIORITY_LABELS = { high: 'Alta', medium: 'Media', low: 'Bassa' }

export default function TaskView() {
  const [tasks, setTasks] = useState([])
  const [labels, setLabels] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [editTask, setEditTask] = useState(null)
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: null, due_date: '', status: 'todo' })

  useEffect(() => {
    loadTasks()
    loadLabels()
  }, [])

  const loadTasks = async () => { setTasks(await window.api.getTasks({})) }
  const loadLabels = async () => { setLabels(await window.api.getAllLabels()) }

  const handleCreate = async () => {
    if (!newTask.title.trim()) return
    await window.api.createTask(newTask)
    setNewTask({ title: '', description: '', priority: null, due_date: '', status: 'todo' })
    setShowCreate(false)
    loadTasks()
  }

  const handleUpdateStatus = async (taskId, status) => {
    await window.api.updateTask(taskId, { status })
    loadTasks()
  }

  const handleDelete = async (taskId) => {
    await window.api.deleteTask(taskId)
    loadTasks()
  }

  const tasksByStatus = (status) => tasks.filter(t => t.status === status)

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
          <div key={col.key} style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: `2px solid ${col.color}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>{col.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderRadius: 10, padding: '1px 8px' }}>
                {tasksByStatus(col.key).length}
              </span>
            </div>

            {/* Task cards */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
              {tasksByStatus(col.key).map(task => (
                <div key={task.id} className="bg-card" style={{
                  background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: 12,
                  border: '1px solid var(--border)', cursor: 'pointer', transition: 'var(--transition)'
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{task.title}</span>
                    <button className="btn--icon" style={{ width: 20, height: 20 }} onClick={() => handleDelete(task.id)}>
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
                  {/* Status change buttons */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                    {STATUS_COLS.filter(s => s.key !== col.key).map(s => (
                      <button key={s.key} className="btn btn--ghost" style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={() => handleUpdateStatus(task.id, s.key)}>
                        → {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
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
    </>
  )
}
