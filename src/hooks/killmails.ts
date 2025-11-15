import differenceInMilliseconds from 'date-fns/differenceInMilliseconds'
import { useCallback, useEffect } from 'react'
import pickBy from 'lodash/pickBy'
import create from 'zustand'
import parseISO from 'date-fns/parseISO'
import { scaleValue } from '../utils/scaling'
import { useConnection } from './connection'

export const normalKillmailAgeMs = 45 * 1000
const trimIntervalMs = 5 * 1000
const reconnectIntervalMs = trimIntervalMs
const maxKillmailAgeMs = 5 * 60 * 1000 // Only accept killmails from the last 5 minutes

type WebsocketKillmail = {
  killmail_id: number
  killmail_time: string
  solar_system_id: number
  victim: {
    alliance_id?: number
    character_id: number
    corporation_id: number
    ship_type_id: number
    position: {
      x: number,
      y: number,
      z: number
    }
  }
  zkb: {
    totalValue: number
    fittedValue: number
    locationID: number
    npc: boolean
    awox: boolean
    solo: boolean
    url: string
  }
}

type State = {
  killmails: Record<string, Killmail>,
  focused?: Killmail,
  receiveKillmail: (killmail: Killmail) => void,
  trimKillmails: () => void,
  focus: (id: Killmail['id']) => void,
  unfocus: (id: Killmail['id']) => void
}

const shouldKeep = (now: Date, killmail: Killmail) => {
  const { scaledValue, receivedAt } = killmail
  const age = differenceInMilliseconds(now, receivedAt)
  return age < normalKillmailAgeMs * scaledValue
}

const parseKillmail = (raw: WebsocketKillmail): Killmail => {
  const { killmail_id, killmail_time, victim, solar_system_id, zkb } = raw
  const { character_id, corporation_id, alliance_id, ship_type_id } = victim
  const { url, totalValue } = zkb
  const time = parseISO(killmail_time)

  return {
    id: killmail_id,
    time,
    receivedAt: new Date(),
    characterId: character_id,
    corporationId: corporation_id,
    allianceId: alliance_id,
    shipTypeId: ship_type_id,
    solarSystemId: solar_system_id,
    url,
    totalValue,
    scaledValue: scaleValue(totalValue)
  }
}

export const useKillmails = create<State>(set => ({
  killmails: {},
  focused: undefined,
  receiveKillmail: (killmail) => { set(state => ({ killmails: { ...state.killmails, [killmail.id]: killmail } })) },
  trimKillmails: () => {
    const shouldKeepNow = shouldKeep.bind(undefined, new Date())
    set(state => {
      const killmails = pickBy(state.killmails, shouldKeepNow)
      const changes: Partial<State> = { killmails }
      if (state.focused && !killmails[state.focused.id]) {
        changes.focused = undefined
      }
      return changes
    })
  },
  focus: (id) => { set(state => ({ focused: state.killmails[id] })) },
  unfocus: (id) => { set(state => state.focused && state.focused.id === id ? { focused: undefined } : {}) }
}))

export const useKillmailMonitor = (sourceUrl: string): void => {
  const receivePing = useConnection(useCallback(state => state.receivePing, []))
  const trimKillmails = useKillmails(useCallback(state => state.trimKillmails, []))
  const receiveKillmail = useKillmails(useCallback(state => state.receiveKillmail, []))
  const killmails = useKillmails(useCallback(state => state.killmails, []))

  useEffect(() => {
    const interval = setInterval(trimKillmails, trimIntervalMs)
    return () => clearInterval(interval)
  }, [trimKillmails])

  useEffect(() => {
    let isActive = true
    let pollTimeout: ReturnType<typeof setTimeout>

    const pollForKillmails = async () => {
      if (!isActive) return

      try {
        const response = await fetch(sourceUrl, {
          redirect: 'follow' // Handle redirects to /object.php
        })

        if (!response.ok) {
          if (response.status === 429) {
            console.warn('Rate limited (429), backing off...')
            // Back off on rate limit
            pollTimeout = setTimeout(pollForKillmails, reconnectIntervalMs * 2)
            return
          }
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const data = await response.json()

        if (data.package) {
          console.log('data.package:', data.package)
        }

        // RedisQ returns {package: {...}} or {package: null}
        if (data.package && !data.package.killmail) {
            console.log("No killmail in package:", data.package)
        }
        if (data.package && data.package.killmail) {
          const { killmail, zkb } = data.package
          const killmailId = killmail.killmail_id

          // Skip if we already have this killmail (prevents duplicates)
          if (killmails[killmailId]) {
            // Continue polling immediately
            pollTimeout = setTimeout(pollForKillmails, 100)
            return
          }

          // Check if killmail is too old (filter out old queued killmails)
          const killmailTime = parseISO(killmail.killmail_time)
          const killmailAge = differenceInMilliseconds(new Date(), killmailTime)
          if (killmailAge > maxKillmailAgeMs) {
            console.log(`Skipping old killmail (${Math.round(killmailAge / 1000 / 60)} minutes old)`)
            // Continue polling immediately to clear out old killmails from queue
            pollTimeout = setTimeout(pollForKillmails, 100)
            return
          }

          const killmailData: WebsocketKillmail = {
            killmail_id: killmailId,
            killmail_time: killmail.killmail_time,
            solar_system_id: killmail.solar_system_id,
            victim: killmail.victim,
            zkb: zkb
          }

          console.log('killmailData:', killmailData)

          receiveKillmail(parseKillmail(killmailData))
        }

        // Send periodic ping to keep connection status updated
        receivePing()

        // Continue polling immediately
        pollTimeout = setTimeout(pollForKillmails, 100)
      } catch (error) {
        console.error('Error polling RedisQ:', error)
        // Retry after interval on error
        pollTimeout = setTimeout(pollForKillmails, reconnectIntervalMs)
      }
    }

    // Start polling
    pollForKillmails()

    return () => {
      isActive = false
      if (pollTimeout) {
        clearTimeout(pollTimeout)
      }
    }
  }, [sourceUrl, receiveKillmail, receivePing, killmails])
}
