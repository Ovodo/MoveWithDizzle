/* Recommendations */
/*  
    - When applying, participants submit their preferred payment methods and the average time they take 
      to send or receive funds.
    - If a participant does not wish to receive SUI as payment, they must lock up the SUI equivalent in 
      escrow. This ensures the sender's ability to complete the transaction reliably.
    - Users / Applicants can filter for payment methods, currency, and then type of transaction (sending / receiving). 
      This can help find if a singular participant can complete the transaction.
    -   Incentivize users and participants my rewarding them the `lockup` token for using the platform.
*/
/* Actions on the platform */
/*
    - Sending :- 
        This is a User who wants to send money through the platform. 
        The `applicant` would need to:
            1. Select a payment method, the amount, and the currency to send.
            2. Pick a participant from the list of available matches who is willing to facilitate the transaction.
            3. Provide the recipient's payment details, including their preferred method and account information.
            4. Make payments and wait for the participant to complete the transaction to the recipient.
    - Receiving :- 
        This is a User who wants to receive money from another country through the platform. 
        The `applicant` would need to:
            1. Select a payment method and the desired currency to receive.
            2. Pick a participant from the list of available matches who is willing to facilitate the transaction.
            3. Once the `receiver` confirms the payment, SUI is locked up on the platform.
            4. `Applicant` can choose to cash out directly as SUI or indirectly as any preferred currency using the 
                Sending action.
    - Receiver :-
        This is a participant who wants to receive money on behalf of others on the platform.
        The `receiver` would need to:
            1. Log in to the platform and apply to be a receiver.
            2. Fill in details of different available payment methods in which the `receiver` can receive money, 
               along with the average time it takes for the receiver to process the money and the currencies they support.
            3. Lock up SUI and indicate that they are online and ready to receive a particular range of money. 
               `Receiver` cannot lock up less than the amount they intend to process. The more SUI locked up, the higher the 
               amount they can receive.
            4. Once the receiver confirms the payment, the fiat amount in SUI would be deducted from the user's balance.
    - Sender :-
        This is a participant who wants to send money on behalf of others on the platform. 
        The `sender` would need to:
            1. Log in to the platform and apply to be a sender.
            2. Fill in details of their available payment methods and currencies, including the average time it takes 
               them to process outgoing payments.
            3.  Indicate they are online and available to send by selecting range of amount and currencies the can send.
            4. Once a transaction is matched, the sender is notified and must confirm when the payment to the recipient 
               has been successfully processed.
            5. Upon confirmation, the equivalent amount of  SUI is released to the sender, and the transaction is marked as completed.
*/
#[allow(lint(self_transfer),unused_field, unused_use)]
module payments::lockup{
	use sui::coin::{Self,Coin};
	use sui::sui::SUI;
	use sui::balance::{Self,Balance};
	use std::debug::print;
	use std::string;
	use sui::clock::{Self,Clock};
	use sui::table;
	use sui::{dynamic_object_field as dof, event};
	#[test_only]
    use sui::test_scenario;
	#[test_only]
    use sui::test_utils::assert_eq;


  	/*==============================================================================================
  	  Constants - Add your constants here (if any)
  	==============================================================================================*/
  
  	const NotInit: u64 = 15;
	const NotKool: u8 = 18;
  
  	/*==============================================================================================
  	  Error codes - DO NOT MODIFY
  	==============================================================================================*/
  
  	const ErrSenderMismatch: u64 = 0;
	const ErrNotEnuoghSui: u64 = 1;
	const ErrTxInProgress: u64 = 2;
	const ErrAddressMismatch: u64 = 3;
	const ErrLockedVaultIsOccupied: u64 = 24;
	const ErrKeyMismatch: u64 = 5;
	const ErrNotCompleted: u64 = 5;
	const ENotSameAddress: u64 = 80;
  


    // --------------------------------Structs -----
    public struct LockUp has key {
        id: UID,
        users:table::Table<address,User>,
        online_users:vector<OnlineUsers>,
        cross_border_payments: vector<CrossBorderPayment>,
    }

    public struct Vault has store {
        balance:Balance<SUI>
    }

    public struct SuiAmount has copy, store, drop {}

    public struct LockedSui<phantom Coin> has key, store {
        id: UID,
        key: ID,
    }
    public struct OnlineUsers has store, drop {
        user:address,
        min:u64,
        max:u64,
        currency:vector<u8>,
        last_seen:u64,
        receiver:bool
    }

    public struct Key has key, store { id: UID }
    
    public struct CrossBorderPayment has store {
        id:u64,
        creator:address,
        in:Transaction,
        out:Transaction,
        completed:bool,
        failed:bool,
        created:u64,
        amount_in_sui:u64,
        sui:Option<Balance<SUI>>,
        key:Option<Key>
    }
    public struct Transaction has store {
        id: u64,
        sender: Option<address>,   
        receiver:Option<address>,
        started:Option<u64>,
        finished:Option<u64>,
        currency:vector<u8>,
        amount_in_fiat:u64,
        sent:bool,
        received:bool,
    }
    public struct User has store,drop {
        total_trades_completed:u64,
        average_complete_time:u64,
        total_completion_time:u64,
        online:bool,
        // payment_methods:vector<string::String>
    }
    // inside pact space forget wet sign amateur vanish drive pulse exhibit throw
    public struct AdminCap has key, store {
        id: UID,
    }
    //---------------------------- Events ----------------------------
    public struct SuiLocked has copy, drop {
        amount:u64,
        owner:address,
        key_id:ID,
        lock_id:ID
    }
    public struct CbpCreated has copy, drop {
    creator:address,
    id:u64,
    }
    fun init(ctx: &mut TxContext) {
        let cap = AdminCap {
            id:object::new(ctx)
        };
      transfer::transfer(cap,tx_context::sender(ctx));
        let app = LockUp {
            id: object::new(ctx),
            users: table::new(ctx),
            online_users:vector::empty(),
            cross_border_payments: vector::empty<CrossBorderPayment>(),
        }; 
        transfer::share_object(app);
    }
    public fun register_user(app:&mut LockUp, ctx:&mut TxContext){
        let sender = tx_context::sender(ctx);
        let user = User {
            total_trades_completed:0,
            average_complete_time:0,
            total_completion_time:0,
            online:false,
        };
        table::add(&mut app.users , sender, user);
    }
    public fun create_cross_border_payment
    (
        app:&mut LockUp,
        clock:&Clock,
        in_amount_fiat:u64,
        in_currency:vector<u8>,
        out_amount_fiat:u64,
        out_currency:vector<u8>,
        amount_in_sui:u64,
        ctx:&mut TxContext,
        ) {
        let sender = tx_context::sender(ctx);
        let id = (vector::length(&app.cross_border_payments) + 1) ;
        let in = Transaction {
            id,
            sender:option::some(sender),
            receiver:option::none(),
            started:option::none(),
            finished:option::none(),
            currency: in_currency,
            amount_in_fiat:in_amount_fiat,
            sent:false,
            received:false,
        };
        let out = Transaction {
            id,
            sender:option::none(),
            receiver:option::some(sender),
            started:option::none(),
            finished:option::none(),
            currency: out_currency,
            amount_in_fiat:out_amount_fiat,
            sent:false,
            received:false,
        };
        let cbp = CrossBorderPayment {
            id,
            creator:sender,
            in,
            out,
            completed:false,
            failed:false,
            created:clock::timestamp_ms(clock),
            amount_in_sui,
            sui:option::none(),
            key:option::none()
        };
        vector::push_back(&mut app.cross_border_payments, cbp);
        event::emit(CbpCreated {
            creator: sender,
            id,
        });
    }
    public fun cancel_transaction(transaction:&mut Transaction,in:bool){
        assert!(option::is_none(&transaction.started),ErrTxInProgress);
        if( in) {
            transaction.receiver = option::none();
        }else {
            transaction.sender = option::none();
        }
    }
    public fun update_transaction(transaction:&mut Transaction,in:bool,user:address){
        assert!(option::is_none(&transaction.started),ErrTxInProgress);
        if( in) {
            transaction.receiver = option::some(user);
        }else {
            transaction.sender = option::some(user);
        }
    }
    public fun select_receiver(app:&mut LockUp, cbp_id:u64, receiver_address: address){
        let cbp = vector::borrow_mut(&mut app.cross_border_payments, cbp_id);
        let in = &mut cbp.in;
        // assert!(option::is_none(&cbp.sui),ErrLockedVaultIsOccupied);
        in.receiver = option::some(receiver_address);
    }
    public fun sender_accept_cbp(app:&mut LockUp, cbp_id:u64, ctx:&mut TxContext){
        let sender = tx_context::sender(ctx);
        let cbp = vector::borrow_mut(&mut app.cross_border_payments, cbp_id);
        let out = &mut cbp.out;
        assert!(option::is_none(&out.sender),5);
        out.sender = option::some(sender);
    }
    public fun confirm_sent_payment(app:&mut LockUp, cbp_id:u64, clock:&Clock, ctx:&mut TxContext) {
        let sender = tx_context::sender(ctx);
        let cbp = vector::borrow_mut(&mut app.cross_border_payments, cbp_id);
        let transaction = &mut cbp.in;
        assert!(option::some(sender) == transaction.sender,ErrSenderMismatch);
        transaction.sent = true;
        transaction.started = option::some(clock::timestamp_ms(clock));
    }
    public fun confirm_received_payment(app:&mut LockUp, cbp_id:u64, clock:&Clock, ctx:&mut TxContext) {
        let sender = tx_context::sender(ctx);
        let cbp = vector::borrow_mut(&mut app.cross_border_payments, cbp_id);
        let transaction = &mut cbp.in;
        assert!(option::some(sender) == transaction.receiver,ErrSenderMismatch);
        transaction.received = true;
        transaction.finished = option::some(clock::timestamp_ms(clock));
    }
    public fun release_sui(app:&mut LockUp, cbp_id:u64, ctx:&mut TxContext){
        let cbp = vector::borrow_mut(&mut app.cross_border_payments, cbp_id);
        assert!(cbp.out.received,ErrNotCompleted);
        assert!(cbp.in.received,ErrNotCompleted);
        let sui = option::extract(&mut cbp.sui);
        let sui = coin::from_balance(sui, ctx);
        transfer::public_transfer(sui, *option::borrow(&cbp.out.sender));
    }
      public fun add_to_online_users(app:&mut LockUp,receiver:bool,clock:&Clock, min:u64,max:u64,currency:vector<u8>,_locked_sui:&LockedSui<Coin<SUI>>, ctx:&mut TxContext){
        if(receiver){
            let sui_balance = dof::borrow<SuiAmount,Coin<SUI>>(&_locked_sui.id,SuiAmount {});
            assert!(coin::value(sui_balance) >= max,ErrNotEnuoghSui);
        };
        let online_user = OnlineUsers {
            user:tx_context::sender(ctx),
            min,
            max,
            currency,
            receiver:receiver,
            last_seen:clock::timestamp_ms(clock)
        };
        vector::push_back(&mut app.online_users, online_user);
    }
    public fun remove_from_online_users(app:&mut LockUp, ctx:&mut TxContext){
        let mut index = vector::find_index!(&app.online_users, |e| e.user == tx_context::sender(ctx));
        vector::remove(&mut app.online_users, option::extract(&mut index));
    }
    public fun lock_sui(sui:Coin<SUI>, ctx:&mut TxContext) {
        let sender = tx_context::sender(ctx);
        let key = Key { id:object::new(ctx)};
        let mut lock = LockedSui<Coin<SUI>> { id:object::new(ctx), key:object::id(&key) };
        // transfer::transfer(key, sender);
        // transfer::transfer(lock, sender);
        event::emit(SuiLocked {
            amount:coin::value(&sui),
            owner:sender,
            key_id:object::id(&key),
            lock_id:object::id(&lock),
        });
        dof::add(&mut lock.id, SuiAmount {}, sui);
        transfer::transfer(key,sender);
        transfer::transfer(lock,sender);
        // (key,lock)
    }
    #[allow(lint(custom_state_change))]
    public fun add_to_locked_sui(sui_to_add:Coin<SUI>,lock:&mut LockedSui<Coin<SUI>>,key:Key, ctx:&mut TxContext){
        let sender = tx_context::sender(ctx);
        assert!(lock.key == object::id(&key),ErrKeyMismatch);
        let sui = dof::borrow_mut<SuiAmount, Coin<SUI>>(&mut lock.id, SuiAmount {});
        coin::join(sui, sui_to_add);
        transfer::transfer(key,sender);
    }
    #[allow(lint(custom_state_change))]
    public fun remove_from_locked_sui(sui_to_remove:u64,lock:&mut LockedSui<Coin<SUI>>,key:Key, ctx:&mut TxContext){
        let sender = tx_context::sender(ctx);
        assert!(lock.key == object::id(&key),ErrKeyMismatch);
        let sui = dof::borrow<SuiAmount, Coin<SUI>>(&lock.id, SuiAmount {});
        assert!(coin::value(sui) > sui_to_remove,ErrNotEnuoghSui);
        let sui = dof::borrow_mut<SuiAmount, Coin<SUI>>(&mut lock.id, SuiAmount {});
        let coin = coin::take<SUI>(coin::balance_mut(sui), sui_to_remove,ctx);
        transfer::public_transfer(coin,sender);
        transfer::transfer(key,sender);
    }
    // View Functions //
//    public fun filter_users_by_payment_method(users: vector<User>,payment_method:&string::String) : vector<User>{
//         let filtered_users = vector::filter!<User>(users, |e| vector::contains(&e.payment_methods, payment_method));
//         filtered_users
//     }
    public fun get_cbp(app:&mut LockUp,id:u64):&CrossBorderPayment {
        let mut index = vector::find_index!(&app.cross_border_payments, |e| e.id == id);
        let cbp = vector::borrow(&app.cross_border_payments, option::extract(&mut index));
        cbp
    }
    /// Helper Methods ///
    fun calculate_user_statistics(app:&mut LockUp,id:u64,incoming:bool){
        let  cbp = vector::borrow(&app.cross_border_payments, id);
        if(incoming){
            let completion_time = *option::borrow<u64>(&cbp.in.finished)  - *option::borrow<u64>(&cbp.in.started);
            {
            //Update receiver stats
            let user_data_receiver = table::borrow_mut(&mut app.users, *option::borrow(&cbp.in.receiver));
            user_data_receiver.total_trades_completed = user_data_receiver.average_complete_time + 1;
            user_data_receiver.total_completion_time = user_data_receiver.total_completion_time + completion_time;
            user_data_receiver.average_complete_time = user_data_receiver.total_completion_time/user_data_receiver.total_trades_completed
            };
            {
            //Update sender stats
            let user_data_sender = table::borrow_mut(&mut app.users, *option::borrow(&cbp.in.sender));
            user_data_sender.total_trades_completed = user_data_sender.average_complete_time + 1;
            user_data_sender.total_completion_time = user_data_sender.total_completion_time + completion_time;
            user_data_sender.average_complete_time = user_data_sender.total_completion_time/user_data_sender.total_trades_completed
            };
        }
        else {
        let completion_time = *option::borrow<u64>(&cbp.out.finished)  - *option::borrow<u64>(&cbp.out.started);
       { //Update receiver stats
        let user_data_receiver = table::borrow_mut(&mut app.users, *option::borrow(&cbp.out.receiver));
        user_data_receiver.total_trades_completed = user_data_receiver.average_complete_time + 1;
        user_data_receiver.total_completion_time = user_data_receiver.total_completion_time + completion_time;
        user_data_receiver.average_complete_time = user_data_receiver.total_completion_time/user_data_receiver.total_trades_completed};
      {  //Update sender stats
        let user_data_sender = table::borrow_mut(&mut app.users, *option::borrow(&cbp.out.sender));
        user_data_sender.total_trades_completed = user_data_sender.average_complete_time + 1;
        user_data_sender.total_completion_time = user_data_sender.total_completion_time + completion_time;
        user_data_sender.average_complete_time = user_data_sender.total_completion_time/user_data_sender.total_trades_completed};
        };
    }
      #[test]
    fun test_init_success() {
        let module_owner = @0xa;
        let mut scenario_val = test_scenario::begin(module_owner);
        let scenario = &mut scenario_val;
        {
            init(test_scenario::ctx(scenario));
            let tx = test_scenario::next_tx(scenario, module_owner);
            let expected_shared_objects = 1;
            let expected_created_objects = 2;
            assert_eq(
                vector::length(&test_scenario::created(&tx)),
                expected_created_objects
            );
            assert_eq(
                vector::length(&test_scenario::shared(&tx)),
                expected_shared_objects
            );
            // print(&string::utf8(b"this is awesome"))
        };
        {
            let  mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            let mut app = test_scenario::take_shared<LockUp>(scenario);
            clock.set_for_testing(5000);
            create_cross_border_payment( &mut app,&clock,10000,b"NGN",70000,b"USD",30,test_scenario::ctx(scenario)
            );
            // print(&app.cross_border_payments);
            test_scenario::return_shared(app);
            clock.destroy_for_testing();
        };
        test_scenario::end(scenario_val);
    }
      #[test]
    fun test_lock_sui() {
        let module_owner = @0xa;
        let mut scenario_val = test_scenario::begin(module_owner);
        let scenario = &mut scenario_val;
        {
            init(test_scenario::ctx(scenario));
            let payment = coin::mint_for_testing<SUI>(10, test_scenario::ctx(scenario));
            lock_sui(payment, test_scenario::ctx(scenario));
        };
        test_scenario::next_tx(scenario,module_owner);
        {
            let lock = test_scenario::take_from_sender<LockedSui<Coin<SUI>>>(scenario);
            let sui_amount = dof::borrow<SuiAmount, Coin<SUI>>(&lock.id, SuiAmount {});
            assert!(coin::value(sui_amount) == 10,200);
            test_scenario::return_to_sender(scenario,lock);
        };
        test_scenario::end(scenario_val);
    }
    #[test]
    fun test_receiver_accepts_cbp() {
        let module_owner = @0xa;
        let receiver_intermediary = @0xb;
        let mut scenario_val = test_scenario::begin(module_owner);
        let scenario = &mut scenario_val;
        {
            init(test_scenario::ctx(scenario));
            test_scenario::next_tx(scenario, module_owner);
        };
        let mut app = test_scenario::take_shared<LockUp>(scenario);
        {
            let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock.set_for_testing(5000);
            create_cross_border_payment(&mut app, &clock, 10000, b"NGN", 70000, b"USD", 30, test_scenario::ctx(scenario));
            clock.destroy_for_testing();
        };
        test_scenario::next_tx(scenario, receiver_intermediary);
        {
            let cbp_id = 0;
            let payment = coin::mint_for_testing<SUI>(50, test_scenario::ctx(scenario));
            lock_sui(payment, test_scenario::ctx(scenario));
            test_scenario::next_tx(scenario, receiver_intermediary);
            let mut lock = test_scenario::take_from_sender<LockedSui<Coin<SUI>>>(scenario);
            select_receiver(&mut app, cbp_id, receiver_intermediary);
            test_scenario::return_to_sender(scenario, lock);
        };
        let _tx = test_scenario::next_tx(scenario, module_owner);
// 
        {
            let cbp = vector::borrow(&app.cross_border_payments, 0);
            // assert!(option::is_some(&cbp.sui), ErrNotEnuoghSui);
            assert!(cbp.in.receiver == option::some(receiver_intermediary), ErrAddressMismatch);
            test_scenario::return_shared(app);
        };
        test_scenario::end(scenario_val);
    }
    #[test]
    fun test_user_flow() {
        let module_owner = @0xa;
        let receiver_intermediary = @0xb;
        let mut scenario_val = test_scenario::begin(module_owner);
        let scenario = &mut scenario_val;
        {
            init(test_scenario::ctx(scenario));
            test_scenario::next_tx(scenario, module_owner);
        };
        let mut clock = clock::create_for_testing(test_scenario::ctx(scenario));
        clock.set_for_testing(5000);
        {
            let mut app = test_scenario::take_shared<LockUp>(scenario);
            register_user(&mut app, test_scenario::ctx(scenario));
            create_cross_border_payment(&mut app, &clock, 10000, b"NGN", 70000, b"USD", 30, test_scenario::ctx(scenario));
            test_scenario::return_shared(app);
        };
        test_scenario::next_tx(scenario, receiver_intermediary);
        {
            let mut app = test_scenario::take_shared<LockUp>(scenario);
            register_user(&mut app, test_scenario::ctx(scenario));
            let cbp_id = 0;
            let payment = coin::mint_for_testing<SUI>(50, test_scenario::ctx(scenario));
            lock_sui(payment, test_scenario::ctx(scenario));
            test_scenario::next_tx(scenario, receiver_intermediary);
            let mut lock = test_scenario::take_from_sender<LockedSui<Coin<SUI>>>(scenario);
            select_receiver(&mut app, cbp_id, receiver_intermediary);
            test_scenario::return_shared(app);
            test_scenario::return_to_sender(scenario, lock);
        };
        let _tx = test_scenario::next_tx(scenario, module_owner);
        {
            let mut app = test_scenario::take_shared<LockUp>(scenario);
            let cbp_id = 0;
            confirm_sent_payment(&mut app, cbp_id, &clock, test_scenario::ctx(scenario));
            assert!(vector::borrow(&app.cross_border_payments, cbp_id).in.sent, ErrNotCompleted);
            test_scenario::return_shared(app);
        };
        test_scenario::next_tx(scenario, receiver_intermediary);
        {
            let mut app = test_scenario::take_shared<LockUp>(scenario);
            let cbp_id = 0;
            confirm_received_payment(&mut app, cbp_id, &clock, test_scenario::ctx(scenario));
            calculate_user_statistics(&mut app, cbp_id, true);
            test_scenario::return_shared(app);
        };
        clock.destroy_for_testing();
        test_scenario::end(scenario_val);
    }
}
/*sui transaction fees.
min- 0.01%
max- 0.03%
51033cb2-ac2e-490f-bffe-db07f112747d
d5f1004a-218c-4faa-85d8-be1d657a4a05
https://min-api.cryptocompare.com/data/price?fsym=SUI&tsyms=ZAR
*/