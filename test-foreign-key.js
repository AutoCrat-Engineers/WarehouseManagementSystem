import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
async function test() {
    const { data, error } = await supabase.from('packing_requests').select('*, items!inner(item_name)').limit(1)
    console.log(error || 'Success', data)
}
test()
