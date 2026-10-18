import { shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/help'
import { t } from '../../i18n'
import { APP_REPOSITORY_URL } from 'common/appIdentity'

export default function(): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.help.markdownReference'),
      click() {
        shell.openExternal(
          'https://spec.commonmark.org/'
        )
      }
    },
    {
      label: t('menu.help.changelog'),
      click() {
        shell.openExternal(`${APP_REPOSITORY_URL}/releases`)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.askQuestion'),
      click() {
        shell.openExternal(`${APP_REPOSITORY_URL}/issues/new?labels=question`)
      }
    },
    {
      label: t('menu.help.reportBug'),
      click() {
        shell.openExternal(`${APP_REPOSITORY_URL}/issues/new?labels=bug`)
      }
    },
    {
      label: t('menu.help.viewSource'),
      click() {
        shell.openExternal(APP_REPOSITORY_URL)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.license'),
      click() {
        shell.openExternal(`${APP_REPOSITORY_URL}/blob/main/LICENSE`)
      }
    },
    {
      label: t('menu.help.openSourceNotices'),
      click() {
        shell.openExternal(`${APP_REPOSITORY_URL}/blob/main/NOTICE.md`)
      }
    }
  ]

  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help.help'),
    role: 'help',
    submenu
  }

  submenu.push(
    { type: 'separator' },
    { label: t('menu.help.checkUpdates'), click() { shell.openExternal(`${APP_REPOSITORY_URL}/releases/latest`) } }
  )

  if (process.platform !== 'darwin') {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.about'),
        click(_menuItem, browserWindow) {
          actions.showAboutDialog(browserWindow as BrowserWindow | undefined)
        }
      }
    )
  }
  return helpMenu
}
