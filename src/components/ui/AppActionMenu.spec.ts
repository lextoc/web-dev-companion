import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AppActionMenu from './AppActionMenu.vue'
import AppMenuItem from './AppMenuItem.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('AppActionMenu', () => {
  it('opens menu content in a teleport and closes after an enabled menu item is clicked', async () => {
    const wrapper = mount(AppActionMenu, {
      attachTo: document.body,
      props: {
        label: 'Repository actions',
      },
      slots: {
        default: '<AppMenuItem>Copy path</AppMenuItem>',
      },
      global: {
        components: {
          AppMenuItem,
        },
      },
    })

    const trigger = wrapper.get('button.action-menu-trigger')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    await trigger.trigger('click')
    await nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(document.body.querySelector('[role="menu"]')?.textContent).toContain('Copy path')

    document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click()
    await nextTick()
    await nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    wrapper.unmount()
  })

  it('closes when a pointerdown happens outside the trigger and menu', async () => {
    const wrapper = mount(AppActionMenu, {
      attachTo: document.body,
      props: {
        label: 'More actions',
      },
      slots: {
        default: '<AppMenuItem>Open terminal</AppMenuItem>',
      },
      global: {
        components: {
          AppMenuItem,
        },
      },
    })

    const trigger = wrapper.get('button.action-menu-trigger')
    await trigger.trigger('click')
    await nextTick()

    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    wrapper.unmount()
  })
})
