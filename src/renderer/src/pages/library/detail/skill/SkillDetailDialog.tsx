import { Badge, Button, Dialog, DialogContent, DialogTitle, Separator } from '@cherrystudio/ui'
import type { InstalledSkill } from '@types'
import type { TFunction } from 'i18next'
import { Clock, X, Zap } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  skill: InstalledSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function timeAgo(t: TFunction, dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('library.time_ago.just_now')
  if (mins < 60) return t('library.time_ago.minutes', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('library.time_ago.hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('library.time_ago.days', { count: days })
  return t('library.time_ago.months', { count: Math.floor(days / 30) })
}

const SkillDetailDialog: FC<Props> = ({ skill, open, onOpenChange }) => {
  const { t } = useTranslation()

  if (!skill) return null

  const sourceTags = skill.sourceTags ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 backdrop-blur-sm"
        className="max-h-[calc(100vh-48px)] w-170 gap-0 overflow-hidden rounded-lg border-border/30 bg-card p-0 shadow-2xl sm:max-w-170">
        <div className="flex items-start justify-between gap-4 border-border/15 border-b px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xs bg-amber-500/10 text-amber-500">
              <Zap size={22} strokeWidth={1.5} />
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="truncate text-foreground text-lg leading-6">{skill.name}</DialogTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="border-0 bg-amber-500/10 px-2 py-0.5 text-amber-600 text-xs">
                  {t('library.type.skill')}
                </Badge>
                <span className="text-muted-foreground/50 text-xs">{skill.source}</span>
                {skill.author ? <span className="text-muted-foreground/50 text-xs">{skill.author}</span> : null}
                {sourceTags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-muted-foreground/40 text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant="secondary"
              className="gap-1.5 border-0 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              {t('library.skill_detail.installed')}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.close')}
              onClick={() => onOpenChange(false)}
              className="flex h-7 min-h-0 w-7 shrink-0 items-center justify-center rounded-3xs font-normal text-muted-foreground/40 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-0">
              <X size={14} />
            </Button>
          </div>
        </div>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto px-5 py-5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75">
          <section className="flex flex-col gap-3">
            <h3 className="font-medium text-muted-foreground/70 text-sm">{t('library.skill_detail.description')}</h3>
            <p className="min-h-10 text-muted-foreground/65 text-sm leading-6">
              {skill.description || t('library.skill_detail.no_description')}
            </p>
          </section>

          <Separator className="bg-border/20" />

          <section className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="font-medium text-muted-foreground/60 text-sm">
                {t('library.skill_detail.created_at')}
              </span>
              <div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
                <Clock size={13} />
                <span>{formatDate(skill.createdAt)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-muted-foreground/60 text-sm">
                {t('library.skill_detail.updated_at')}
              </span>
              <div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
                <Clock size={13} />
                <span>
                  {formatDate(skill.updatedAt)} ({timeAgo(t, skill.updatedAt)})
                </span>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SkillDetailDialog
